/**
 * Integracion con la API PUBLICA de Mercado Libre para estimar el costo
 * real de vender + enviar un producto (20/07/2026) -- pedido explicito del
 * usuario: "como hacemos para que le pegue realmente a la api?" (en vez de
 * la tabla fija editable de calc_supuestos).
 *
 * Dos llamadas encadenadas, ambas publicas y SIN autenticacion:
 *   1. domain_discovery/search: predice la categoria de MELI a partir del
 *      nombre del producto (mismo predictor que usa MELI al publicar).
 *   2. listing_prices: dado precio + categoria + tipo de logistica/
 *      publicacion + peso facturable, devuelve la comision y el costo de
 *      envio real.
 *
 * Configuracion fija de Cobus confirmada con el usuario (20/07/2026):
 *   - Mercado Envios Full  -> logistic_type = "fulfillment"
 *   - Publicacion Clasica  -> listing_type_id = "gold_special"
 *
 * IMPORTANTE -- limitacion conocida: no se pudo probar ninguna llamada en
 * vivo esta sesion (las herramientas de red del entorno de desarrollo
 * fallaron en cada intento, con y sin parametros, incluso contra APIs
 * ajenas a MELI). El parseo de la respuesta de listing_prices es
 * defensivo (prueba varias claves candidatas conocidas de la
 * documentacion publica de MELI) pero NO esta confirmado contra una
 * respuesta real. Por eso:
 *   - Todo este modulo devuelve `null`/error en vez de tirar excepcion --
 *     el caller (app/api/calc/run/route.ts) SIEMPRE tiene que poder caer
 *     de vuelta a la tabla fija de tamano_envio si esto no funciona.
 *   - Se guarda el JSON crudo de la respuesta (recortado) en
 *     calc_product_types.envio_meli_api_razonamiento para poder revisar a
 *     mano la primera vez que se use en produccion y ajustar
 *     `extraerCostoEnvio()` si las claves no coinciden.
 */

const ML_SITE = "MLA";
const LOGISTIC_TYPE = "fulfillment"; // Mercado Envios Full
const LISTING_TYPE_ID = "gold_special"; // Publicacion Clasica

export interface CategoriaMeli {
  categoryId: string | null;
  categoryNombre: string | null;
}

export interface CostosMeliResult {
  envioArs: number | null;
  comisionArs: number | null;
  /** JSON crudo (recortado) de la respuesta, para poder auditar/ajustar el
   * parser si `envioArs` sale null inesperadamente. */
  rawTexto: string;
  error?: string;
}

function conTimeout(ms: number): AbortSignal {
  // AbortSignal.timeout no esta en todas las runtimes de Vercel/Node
  // todavia -- fallback manual por las dudas.
  if (typeof (AbortSignal as any).timeout === "function") return (AbortSignal as any).timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Predice la categoria de Mercado Libre a partir del nombre del producto. */
export async function predecirCategoriaMeli(nombreProducto: string): Promise<CategoriaMeli> {
  try {
    const url = `https://api.mercadolibre.com/sites/${ML_SITE}/domain_discovery/search?limit=1&q=${encodeURIComponent(
      nombreProducto
    )}`;
    const resp = await fetch(url, { signal: conTimeout(15_000) });
    if (!resp.ok) return { categoryId: null, categoryNombre: null };
    const data: any = await resp.json();
    const first = Array.isArray(data) ? data[0] : null;
    return {
      categoryId: first?.category_id ?? null,
      categoryNombre: first?.category_name ?? null,
    };
  } catch {
    return { categoryId: null, categoryNombre: null };
  }
}

/** Busca de forma tolerante un costo de envio dentro de la respuesta de
 * listing_prices -- se prueban varias rutas candidatas conocidas de la
 * documentacion publica de MELI, porque no se pudo confirmar la forma
 * exacta del JSON en vivo esta sesion. */
function extraerCostoEnvio(data: any): number | null {
  const candidatos = [
    data?.shipping?.list_cost,
    data?.shipping?.cost,
    data?.shipping?.user_cost,
    data?.shipping_options?.[0]?.list_cost,
    data?.shipping_options?.[0]?.cost,
  ];
  for (const c of candidatos) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
  }
  return null;
}

function extraerComision(data: any): number | null {
  const v = data?.sale_fee_amount;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Consulta el costo real de vender+enviar un producto en Mercado Libre
 * Argentina via la API publica `listing_prices`, con la configuracion fija
 * de Cobus (Full + Clasica). Nunca tira excepcion: en caso de error
 * devuelve `envioArs: null` + `error` para que el caller pueda caer de
 * vuelta a la tabla fija de calc_supuestos.
 */
export async function consultarCostosMeli(params: {
  price: number;
  categoryId: string;
  billableWeightKg: number;
}): Promise<CostosMeliResult> {
  const { price, categoryId, billableWeightKg } = params;
  try {
    const url =
      `https://api.mercadolibre.com/sites/${ML_SITE}/listing_prices` +
      `?price=${encodeURIComponent(price)}` +
      `&category_id=${encodeURIComponent(categoryId)}` +
      `&listing_type_id=${LISTING_TYPE_ID}` +
      `&logistic_type=${LOGISTIC_TYPE}` +
      `&shipping_modes=me2` +
      `&billable_weight=${encodeURIComponent(billableWeightKg)}`;
    const resp = await fetch(url, { signal: conTimeout(15_000) });
    const rawTexto = await resp.text();
    if (!resp.ok) {
      return { envioArs: null, comisionArs: null, rawTexto: rawTexto.slice(0, 500), error: `API ML respondio ${resp.status}` };
    }
    let data: any;
    try {
      data = JSON.parse(rawTexto);
    } catch {
      return { envioArs: null, comisionArs: null, rawTexto: rawTexto.slice(0, 500), error: "Respuesta de API ML no es JSON valido" };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      envioArs: extraerCostoEnvio(row),
      comisionArs: extraerComision(row),
      rawTexto: JSON.stringify(row).slice(0, 500),
    };
  } catch (err: any) {
    return { envioArs: null, comisionArs: null, rawTexto: "", error: String(err?.message ?? err) };
  }
}
