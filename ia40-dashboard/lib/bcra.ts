/**
 * Cliente de la API publica del BCRA (21/07/2026) -- pedido explicito del
 * usuario: traer el tipo de cambio oficial automaticamente en vez de
 * cargarlo siempre a mano en "Supuestos generales" (que hoy queda editable
 * de todas formas, porque el usuario aclaro que el dolar "es un valor
 * bastante oscilante" y quiere poder pisarlo cuando haga falta).
 *
 * Endpoint: GET https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD
 * (API de Estadisticas Cambiarias del BCRA, sin autenticacion). Devuelve el
 * ultimo valor disponible de "tipoCotizacion" para el dolar oficial
 * (Comunicacion A 3500), confirmado en vivo (21/07/2026) con esta forma de
 * respuesta:
 *   { status, metadata, results: [ { fecha, detalle: [ { codigoMoneda,
 *       descripcion, tipoPase, tipoCotizacion } ] } ] }
 *
 * Nunca tira excepcion mas alla de este archivo sin control: el caller
 * (endpoint refresh-tipo-cambio) decide que hacer con el error -- el
 * supuesto de tipo de cambio configurado a mano NUNCA se pisa solo, esto
 * solo corre cuando el usuario aprieta el boton de actualizar.
 */

const BCRA_URL = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD";

export interface TipoCambioBcra {
  valor: number;
  fecha: string;
}

function conTimeout(ms: number): AbortSignal {
  if (typeof (AbortSignal as any).timeout === "function") return (AbortSignal as any).timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Consulta el dolar oficial (BCRA, Comunicacion A 3500) mas reciente. Tira
 * un Error con mensaje legible si algo falla -- el caller debe atraparlo. */
export async function obtenerTipoCambioOficialBcra(): Promise<TipoCambioBcra> {
  const resp = await fetch(BCRA_URL, { signal: conTimeout(15_000) });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`El BCRA respondio ${resp.status}: ${text.slice(0, 300)}`);
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta del BCRA no es JSON valido: ${text.slice(0, 300)}`);
  }
  const resultado = Array.isArray(data?.results) ? data.results[data.results.length - 1] : null;
  const detalle = Array.isArray(resultado?.detalle) ? resultado.detalle[0] : null;
  const valor = typeof detalle?.tipoCotizacion === "number" ? detalle.tipoCotizacion : Number(detalle?.tipoCotizacion);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`El BCRA no devolvio una cotizacion valida: ${text.slice(0, 300)}`);
  }
  return { valor, fecha: resultado?.fecha ?? "" };
}
