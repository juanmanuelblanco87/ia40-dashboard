import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { estimarArancel, estimarIva, estimarCbm, estimarPvpMercado, estimarPesoKg, CalcAiError } from "@/lib/calcAi";
import { tamanoEnvioPorCbm } from "@/lib/importCalc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function toNumbers(row: any) {
  return {
    ...row,
    arancel_pct: row.arancel_pct != null ? Number(row.arancel_pct) : null,
    iva_pct: row.iva_pct != null ? Number(row.iva_pct) : null,
    trader_pct: Number(row.trader_pct ?? 0),
    tamano_envio: row.tamano_envio === "chico" || row.tamano_envio === "grande" ? row.tamano_envio : "mediano",
    peso_kg: row.peso_kg != null ? Number(row.peso_kg) : null,
    envio_meli_api_ars: row.envio_meli_api_ars != null ? Number(row.envio_meli_api_ars) : null,
    cbm_m3: row.cbm_m3 != null ? Number(row.cbm_m3) : null,
    pvp_ars_estimado: row.pvp_ars_estimado != null ? Number(row.pvp_ars_estimado) : null,
  };
}

const CAMPOS_VALIDOS = ["arancel", "iva", "cbm", "pvp", "peso"] as const;
type Campo = (typeof CAMPOS_VALIDOS)[number];

/**
 * POST /api/calc/product-types/:id/refresh?field=arancel|iva|cbm|pvp
 *
 * Fuerza una consulta nueva a la IA para UN campo puntual de un tipo de
 * producto (boton "recalcular" en la UI) -- mismo patron que "Consultar
 * precio"/reintento de PVP en el resto de la app.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const field = searchParams.get("field") as Campo | null;
  if (!field || !CAMPOS_VALIDOS.includes(field)) {
    return NextResponse.json({ error: `field debe ser uno de: ${CAMPOS_VALIDOS.join(", ")}` }, { status: 400 });
  }

  const rows = await query<any>(`select * from calc_product_types where id=$1`, [id]);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Tipo de producto no encontrado" }, { status: 404 });
  }
  const producto = rows[0];

  try {
    if (field === "arancel") {
      const r = await estimarArancel(producto.nombre, producto.ncm_code);
      await query(
        `update calc_product_types set arancel_pct=$1, arancel_confianza=$2, arancel_razonamiento=$3,
           arancel_status='found', arancel_fetched_at=now(), updated_at=now() where id=$4`,
        [r.pct, r.confianza, r.razonamiento, id]
      );
    } else if (field === "iva") {
      const r = await estimarIva(producto.nombre);
      await query(
        `update calc_product_types set iva_pct=$1, iva_confianza=$2, iva_razonamiento=$3,
           iva_status='found', iva_fetched_at=now(), updated_at=now() where id=$4`,
        [r.pct, r.confianza, r.razonamiento, id]
      );
    } else if (field === "cbm") {
      const r = await estimarCbm(producto.nombre);
      // Tamaño de envío auto-calculado por CBM (21/07/2026, pedido
      // explicito del usuario) -- ver lib/importCalc.ts, tamanoEnvioPorCbm().
      const tamanoEnvio = r.m3 != null ? tamanoEnvioPorCbm(r.m3) : null;
      await query(
        `update calc_product_types set cbm_m3=$1, cbm_confianza=$2, cbm_razonamiento=$3,
           cbm_status='found', cbm_fetched_at=now(), tamano_envio=coalesce($4, tamano_envio), updated_at=now() where id=$5`,
        [r.m3, r.confianza, r.razonamiento, tamanoEnvio, id]
      );
    } else if (field === "pvp") {
      const r = await estimarPvpMercado(producto.nombre);
      await query(
        `update calc_product_types set pvp_ars_estimado=$1, pvp_confianza=$2, pvp_razonamiento=$3,
           pvp_status=$4, pvp_fetched_at=now(), updated_at=now() where id=$5`,
        [r.pvpArsConIva, r.confianza, r.razonamiento, r.pvpArsConIva != null ? "found" : "not_found", id]
      );
    } else {
      const r = await estimarPesoKg(producto.nombre);
      await query(
        `update calc_product_types set peso_kg=$1, peso_confianza=$2, peso_razonamiento=$3,
           peso_status=$4, peso_fetched_at=now(), updated_at=now() where id=$5`,
        [r.kg, r.confianza, r.razonamiento, r.kg != null ? "found" : "not_found", id]
      );
    }
  } catch (err: any) {
    const msg = err instanceof CalcAiError ? err.message : String(err?.message ?? err);
    const col = field === "pvp" ? "pvp" : field === "peso" ? "peso" : field;
    await query(`update calc_product_types set ${col}_status='error', ${col}_razonamiento=$1, updated_at=now() where id=$2`, [
      msg,
      id,
    ]);
    return NextResponse.json({ error: msg }, { status: 200 });
  }

  const final = await query<any>(`select * from calc_product_types where id=$1`, [id]);
  return NextResponse.json({ productType: toNumbers(final[0]) });
}
