import { NextResponse } from "next/server";
import { obtenerTipoCambioOficialBcra } from "@/lib/bcra";

export const dynamic = "force-dynamic";

/**
 * GET /api/bcra/tipo-cambio
 *
 * Dolar oficial mayorista (BCRA, Comunicacion A 3500) para mostrar en el
 * header de TODA la app (21/07/2026, pedido explicito del usuario: "en el
 * Header colocar el valor de dolar segun el BCRA... es importante entender
 * esto el dia de la fecha y no gasta consulta en IA"). Deliberadamente
 * separado del "Tipo de cambio" editable de Supuestos generales del
 * Calculador -- esto es solo informativo, siempre el dato oficial en vivo,
 * sin guardar nada en la base ni usar IA.
 */
export async function GET() {
  try {
    const { valor, fecha } = await obtenerTipoCambioOficialBcra();
    return NextResponse.json({ valor, fecha });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 200 });
  }
}
