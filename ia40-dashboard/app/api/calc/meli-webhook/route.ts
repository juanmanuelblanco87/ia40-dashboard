import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/calc/meli-webhook
 *
 * Receptor de notificaciones (webhooks) de Mercado Libre (20/07/2026) --
 * la app OAuth se configuro con "Seleccionar Todo" en Topicos para dejarla
 * preparada a futuro, y Mercado Libre exige una "Notificaciones callbacks
 * URL" valida (https) para poder guardar esa configuracion.
 *
 * Por ahora este endpoint NO PROCESA nada -- solo responde 200 OK rapido
 * (Mercado Libre espera respuesta en <500ms, si no reintenta o deshabilita
 * el topico). Cuando haga falta reaccionar a un topico puntual (ej.
 * "orders_v2" o "shipments"), ahi si conviene leer `body.topic` y
 * `body.resource` y actuar en consecuencia -- de momento se loguea nomas
 * para poder ver que esta llegando.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[meli-webhook] notificacion recibida:", JSON.stringify(body).slice(0, 500));
  } catch {
    // Si el body no es JSON valido, no hay nada que hacer -- igual respondemos 200.
  }
  return NextResponse.json({ ok: true });
}

/** Mercado Libre a veces valida el endpoint con un GET antes de guardarlo. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
