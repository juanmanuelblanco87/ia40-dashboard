import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { estimarFleteMaritimo, CalcAiError } from "@/lib/calcAi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/calc/supuestos/refresh-flete
 *
 * Fuerza una consulta nueva a la IA para el costo del flete maritimo
 * internacional (China -> Buenos Aires, contenedor 40HQ) -- pedido
 * explicito del usuario (20/07/2026): "el valor del flete tambien
 * consultarlo a la IA y dejarlo editable en el caso que consigamos algo
 * mejor". El resultado se guarda en calc_supuestos (fila unica) y se puede
 * seguir editando a mano despues via PATCH /api/calc/supuestos.
 */
export async function POST() {
  await query(`insert into calc_supuestos (id) values (1) on conflict (id) do nothing`);

  try {
    const r = await estimarFleteMaritimo();
    if (r.usd != null) {
      await query(
        `update calc_supuestos set flete_maritimo_usd=$1, flete_confianza=$2, flete_razonamiento=$3,
           flete_status='found', flete_fetched_at=now(), updated_at=now() where id=1`,
        [r.usd, r.confianza, r.razonamiento]
      );
    } else {
      await query(
        `update calc_supuestos set flete_status='not_found', flete_razonamiento=$1, flete_fetched_at=now(),
           updated_at=now() where id=1`,
        [r.razonamiento]
      );
    }
  } catch (err: any) {
    const msg = err instanceof CalcAiError ? err.message : String(err?.message ?? err);
    await query(
      `update calc_supuestos set flete_status='error', flete_razonamiento=$1, flete_fetched_at=now(), updated_at=now() where id=1`,
      [msg]
    );
    return NextResponse.json({ error: msg }, { status: 200 });
  }

  const rows = await query<any>(`select * from calc_supuestos where id=1`);
  const row = rows[0];
  return NextResponse.json({
    fleteMaritimoUsd: Number(row.flete_maritimo_usd),
    fleteConfianza: row.flete_confianza,
    fleteRazonamiento: row.flete_razonamiento,
    fleteStatus: row.flete_status,
  });
}
