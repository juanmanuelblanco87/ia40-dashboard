import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { estimarArancel, estimarIva, estimarCbm, CalcAiError } from "@/lib/calcAi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface ProductTypeRow {
  id: number;
  nombre: string;
  ncm_code: string | null;
  arancel_pct: number | null;
  arancel_confianza: string | null;
  arancel_razonamiento: string | null;
  arancel_status: string;
  iva_pct: number | null;
  iva_confianza: string | null;
  iva_razonamiento: string | null;
  iva_status: string;
  trader_pct: number;
  /** 'chico' | 'mediano' | 'grande' -- ver docs/PROYECTO.md, costo de envio
   * de Mercado Envios por tamaño (20/07/2026). */
  tamano_envio: string;
  cbm_m3: number | null;
  cbm_confianza: string | null;
  cbm_razonamiento: string | null;
  cbm_status: string;
  pvp_ars_estimado: number | null;
  pvp_confianza: string | null;
  pvp_razonamiento: string | null;
  pvp_status: string;
  created_at: string;
  updated_at: string;
}

function toNumbers(row: any): ProductTypeRow {
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

/**
 * GET /api/calc/product-types
 * Lista el catalogo ABIERTO de "tipos de producto" del Calculador de
 * Importacion (tabla calc_product_types) -- ver racional completo en
 * docs/PROYECTO.md, seccion "Calculador de Importacion".
 */
export async function GET() {
  const rows = await query<any>(`select * from calc_product_types order by nombre asc`);
  return NextResponse.json({ productTypes: rows.map(toNumbers) });
}

/**
 * POST /api/calc/product-types  { nombre, ncmCode? }
 *
 * Crea un tipo de producto nuevo y dispara EN EL ACTO las 3 estimaciones
 * por IA (arancel, IVA, CBM) en paralelo, para que el catalogo quede listo
 * para usar sin esperar al primer calculo -- pedido explicito del usuario
 * (20/07/2026): "dejar la logica abierta a cualquier categoria". Si alguna
 * estimacion falla, el tipo de producto se crea igual (con esa columna en
 * 'error'/null) -- /api/calc/run reintenta cualquier campo que siga faltando
 * la proxima vez que se use, y el usuario puede recalcular a mano.
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const nombre = String(body?.nombre ?? "").trim();
  if (!nombre) {
    return NextResponse.json({ error: "Falta 'nombre'" }, { status: 400 });
  }
  const ncmCode = body?.ncmCode ? String(body.ncmCode).trim() : null;

  const inserted = await query<any>(
    `insert into calc_product_types (nombre, ncm_code) values ($1, $2)
     on conflict (nombre) do nothing
     returning *`,
    [nombre, ncmCode]
  );
  if (inserted.length === 0) {
    return NextResponse.json({ error: `Ya existe un tipo de producto llamado "${nombre}"` }, { status: 409 });
  }
  const id = inserted[0].id;

  const [arancelR, ivaR, cbmR] = await Promise.allSettled([
    estimarArancel(nombre, ncmCode),
    estimarIva(nombre),
    estimarCbm(nombre),
  ]);

  if (arancelR.status === "fulfilled") {
    await query(
      `update calc_product_types set arancel_pct=$1, arancel_confianza=$2, arancel_razonamiento=$3,
         arancel_status='found', arancel_fetched_at=now(), updated_at=now() where id=$4`,
      [arancelR.value.pct, arancelR.value.confianza, arancelR.value.razonamiento, id]
    );
  } else {
    const msg = arancelR.reason instanceof CalcAiError ? arancelR.reason.message : String(arancelR.reason);
    await query(
      `update calc_product_types set arancel_status='error', arancel_razonamiento=$1, updated_at=now() where id=$2`,
      [msg, id]
    );
  }

  if (ivaR.status === "fulfilled") {
    await query(
      `update calc_product_types set iva_pct=$1, iva_confianza=$2, iva_razonamiento=$3,
         iva_status='found', iva_fetched_at=now(), updated_at=now() where id=$4`,
      [ivaR.value.pct, ivaR.value.confianza, ivaR.value.razonamiento, id]
    );
  } else {
    const msg = ivaR.reason instanceof CalcAiError ? ivaR.reason.message : String(ivaR.reason);
    await query(`update calc_product_types set iva_status='error', iva_razonamiento=$1, updated_at=now() where id=$2`, [
      msg,
      id,
    ]);
  }

  if (cbmR.status === "fulfilled") {
    await query(
      `update calc_product_types set cbm_m3=$1, cbm_confianza=$2, cbm_razonamiento=$3,
         cbm_status='found', cbm_fetched_at=now(), updated_at=now() where id=$4`,
      [cbmR.value.m3, cbmR.value.confianza, cbmR.value.razonamiento, id]
    );
  } else {
    const msg = cbmR.reason instanceof CalcAiError ? cbmR.reason.message : String(cbmR.reason);
    await query(`update calc_product_types set cbm_status='error', cbm_razonamiento=$1, updated_at=now() where id=$2`, [
      msg,
      id,
    ]);
  }

  const final = await query<any>(`select * from calc_product_types where id=$1`, [id]);
  return NextResponse.json({ productType: toNumbers(final[0]) });
}
