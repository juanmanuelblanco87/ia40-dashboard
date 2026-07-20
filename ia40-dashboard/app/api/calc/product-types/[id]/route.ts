import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function toNumbers(row: any) {
  return {
    ...row,
    arancel_pct: row.arancel_pct != null ? Number(row.arancel_pct) : null,
    iva_pct: row.iva_pct != null ? Number(row.iva_pct) : null,
    trader_pct: Number(row.trader_pct ?? 0),
    envio_ars_con_iva: Number(row.envio_ars_con_iva ?? 0),
    cbm_m3: row.cbm_m3 != null ? Number(row.cbm_m3) : null,
    pvp_ars_estimado: row.pvp_ars_estimado != null ? Number(row.pvp_ars_estimado) : null,
  };
}

/**
 * PATCH /api/calc/product-types/:id
 *
 * Edicion manual de cualquier campo del tipo de producto -- nombre, NCM,
 * o cualquiera de los valores estimados por IA (arancel_pct, iva_pct,
 * cbm_m3) para corregirlos a mano, ademas de trader_pct y
 * envio_ars_con_iva que son SIEMPRE manuales (ver docs/PROYECTO.md). Editar
 * a mano un campo de IA lo marca 'found' (se toma como confirmado) y deja
 * un razonamiento indicando que fue editado a mano.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const existing = await query<any>(`select * from calc_product_types where id=$1`, [id]);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Tipo de producto no encontrado" }, { status: 404 });
  }
  const cur = existing[0];

  const nombre = body.nombre !== undefined ? String(body.nombre).trim() : cur.nombre;
  const ncmCode = body.ncmCode !== undefined ? (body.ncmCode ? String(body.ncmCode).trim() : null) : cur.ncm_code;
  const traderPct = body.traderPct !== undefined ? Number(body.traderPct) : Number(cur.trader_pct);
  const envioArsConIva = body.envioArsConIva !== undefined ? Number(body.envioArsConIva) : Number(cur.envio_ars_con_iva);

  const arancelPct = body.arancelPct !== undefined ? Number(body.arancelPct) : Number(cur.arancel_pct ?? 0);
  const arancelStatus = body.arancelPct !== undefined ? "found" : cur.arancel_status;
  const arancelRazonamiento =
    body.arancelPct !== undefined ? "(editado a mano)" : cur.arancel_razonamiento;

  const ivaPct = body.ivaPct !== undefined ? Number(body.ivaPct) : Number(cur.iva_pct ?? 0);
  const ivaStatus = body.ivaPct !== undefined ? "found" : cur.iva_status;
  const ivaRazonamiento = body.ivaPct !== undefined ? "(editado a mano)" : cur.iva_razonamiento;

  const cbmM3 = body.cbmM3 !== undefined ? Number(body.cbmM3) : Number(cur.cbm_m3 ?? 0);
  const cbmStatus = body.cbmM3 !== undefined ? "found" : cur.cbm_status;
  const cbmRazonamiento = body.cbmM3 !== undefined ? "(editado a mano)" : cur.cbm_razonamiento;

  const pvpArsEstimado = body.pvpArsEstimado !== undefined ? Number(body.pvpArsEstimado) : cur.pvp_ars_estimado;
  const pvpStatus = body.pvpArsEstimado !== undefined ? "found" : cur.pvp_status;
  const pvpRazonamiento = body.pvpArsEstimado !== undefined ? "(editado a mano)" : cur.pvp_razonamiento;

  const updated = await query<any>(
    `update calc_product_types set
       nombre=$1, ncm_code=$2, trader_pct=$3, envio_ars_con_iva=$4,
       arancel_pct=$5, arancel_status=$6, arancel_razonamiento=$7,
       iva_pct=$8, iva_status=$9, iva_razonamiento=$10,
       cbm_m3=$11, cbm_status=$12, cbm_razonamiento=$13,
       pvp_ars_estimado=$14, pvp_status=$15, pvp_razonamiento=$16,
       updated_at=now()
     where id=$17
     returning *`,
    [
      nombre,
      ncmCode,
      traderPct,
      envioArsConIva,
      arancelPct,
      arancelStatus,
      arancelRazonamiento,
      ivaPct,
      ivaStatus,
      ivaRazonamiento,
      cbmM3,
      cbmStatus,
      cbmRazonamiento,
      pvpArsEstimado,
      pvpStatus,
      pvpRazonamiento,
      id,
    ]
  );

  return NextResponse.json({ productType: toNumbers(updated[0]) });
}

/** DELETE /api/calc/product-types/:id -- borra un tipo de producto del catalogo. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  const deleted = await query<{ id: number }>(`delete from calc_product_types where id=$1 returning id`, [id]);
  if (deleted.length === 0) {
    return NextResponse.json({ error: "Tipo de producto no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ eliminado: true });
}
