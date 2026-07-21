import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { obtenerTipoCambioOficialBcra } from "@/lib/bcra";

export const dynamic = "force-dynamic";

/**
 * POST /api/calc/supuestos/refresh-tipo-cambio
 *
 * Trae el dolar oficial mas reciente del BCRA (API de Estadisticas
 * Cambiarias, 21/07/2026 -- pedido explicito del usuario: "veamos de
 * integrar a la api de BCRA para el tipo de cambio parece super sencilla")
 * y lo guarda en calc_supuestos. Solo corre cuando el usuario aprieta el
 * boton -- el tipo de cambio configurado nunca se pisa solo, porque el
 * usuario aclaro que quiere poder cargarlo a mano tambien ("es un valor
 * bastante oscilante").
 */
export async function POST() {
  await query(`insert into calc_supuestos (id) values (1) on conflict (id) do nothing`);

  try {
    const { valor, fecha } = await obtenerTipoCambioOficialBcra();
    await query(
      `update calc_supuestos set tipo_cambio_ars=$1, tipo_cambio_fuente_fecha=$2, updated_at=now() where id=1`,
      [valor, fecha || null]
    );
    return NextResponse.json({ tipoCambioArs: valor, tipoCambioFuenteFecha: fecha });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 200 });
  }
}
