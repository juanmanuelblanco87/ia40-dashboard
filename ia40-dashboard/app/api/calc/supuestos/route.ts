import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function toNumbers(row: any) {
  return {
    tipoCambioArs: Number(row.tipo_cambio_ars),
    comisionMlPct: Number(row.comision_ml_pct),
    iibbPct: Number(row.iibb_pct),
    padsPct: Number(row.pads_pct),
    tasaEstadisticaPct: Number(row.tasa_estadistica_pct),
    ley25413Pct: Number(row.ley_25413_pct),
    seguroUsdUnidad: Number(row.seguro_usd_unidad),
    feeBajoTicketArs: Number(row.fee_bajo_ticket_ars),
    umbralEnvioGratisArs: Number(row.umbral_envio_gratis_ars),
    descuentoDistribucionPct: Number(row.descuento_distribucion_pct),
    fleteMaritimoUsd: Number(row.flete_maritimo_usd),
    fleteConfianza: row.flete_confianza as string | null,
    fleteRazonamiento: row.flete_razonamiento as string | null,
    fleteStatus: row.flete_status as string,
    fleteFetchedAt: row.flete_fetched_at as string | null,
    forwarderUsd: Number(row.forwarder_usd),
    despachanteUsd: Number(row.despachante_usd),
    thcUsd: Number(row.thc_usd),
    fleteLocalUsd: Number(row.flete_local_usd),
    manipuleoUsd: Number(row.manipuleo_usd),
    capacidadCbmContenedor: Number(row.capacidad_cbm_contenedor),
  };
}

async function getOrCreateSupuestos(): Promise<any> {
  await query(`insert into calc_supuestos (id) values (1) on conflict (id) do nothing`);
  const rows = await query<any>(`select * from calc_supuestos where id=1`);
  return rows[0];
}

/** GET /api/calc/supuestos -- supuestos generales del Calculador de Importacion. */
export async function GET() {
  const row = await getOrCreateSupuestos();
  return NextResponse.json({ supuestos: toNumbers(row) });
}

/**
 * PATCH /api/calc/supuestos -- edicion manual de cualquier supuesto general
 * (tipo de cambio, comisiones, impuestos, componentes del costo fijo por
 * contenedor, etc.). El flete tambien se puede editar aca a mano (ademas de
 * refrescarse por IA en /api/calc/supuestos/refresh-flete).
 */
export async function PATCH(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const cur = toNumbers(await getOrCreateSupuestos());
  const next = { ...cur, ...body };

  await query(
    `update calc_supuestos set
       tipo_cambio_ars=$1, comision_ml_pct=$2, iibb_pct=$3, pads_pct=$4,
       tasa_estadistica_pct=$5, ley_25413_pct=$6, seguro_usd_unidad=$7,
       fee_bajo_ticket_ars=$8, umbral_envio_gratis_ars=$9, descuento_distribucion_pct=$10,
       flete_maritimo_usd=$11, forwarder_usd=$12, despachante_usd=$13, thc_usd=$14,
       flete_local_usd=$15, manipuleo_usd=$16, capacidad_cbm_contenedor=$17,
       updated_at=now()
     where id=1`,
    [
      Number(next.tipoCambioArs),
      Number(next.comisionMlPct),
      Number(next.iibbPct),
      Number(next.padsPct),
      Number(next.tasaEstadisticaPct),
      Number(next.ley25413Pct),
      Number(next.seguroUsdUnidad),
      Number(next.feeBajoTicketArs),
      Number(next.umbralEnvioGratisArs),
      Number(next.descuentoDistribucionPct),
      Number(next.fleteMaritimoUsd),
      Number(next.forwarderUsd),
      Number(next.despachanteUsd),
      Number(next.thcUsd),
      Number(next.fleteLocalUsd),
      Number(next.manipuleoUsd),
      Number(next.capacidadCbmContenedor),
    ]
  );

  const row = await getOrCreateSupuestos();
  return NextResponse.json({ supuestos: toNumbers(row) });
}
