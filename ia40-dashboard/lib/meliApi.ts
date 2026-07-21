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
 * IMPORTANTE -- limitacion conocida y CONFIRMADA en produccion (20/07/2026):
 * `listing_prices` con `logistic_type=fulfillment` devuelve 403 sin
 * autenticacion -- el costo de Mercado Envios Full depende del contrato de
 * fulfillment de la cuenta real de Cobus, no es un dato publico generico
 * (a diferencia de `domain_discovery`, que si funciona sin auth). Por eso
 * este archivo tambien maneja el flujo OAuth de la cuenta de Mercado Libre
 * de Cobus (ver tabla `meli_oauth` + endpoints `app/api/calc/meli-oauth/*`):
 *   - `getAccessToken()` devuelve un access_token valido, refrescandolo
 *     automaticamente si esta vencido. Tira `MeliAuthError` si todavia no
 *     se autorizo la cuenta (el caller debe caer a la tabla fija en ese
 *     caso, igual que con cualquier otro error de esta integracion).
 *   - Requiere las variables de entorno MELI_CLIENT_ID y
 *     MELI_CLIENT_SECRET (de la app creada en developers.mercadolibre.com.ar
 *     con la cuenta real de Cobus).
 *
 * Todo este modulo devuelve `null`/error en vez de tirar excepcion en
 * `consultarCostosMeli` -- el caller (app/api/calc/run/route.ts) SIEMPRE
 * tiene que poder caer de vuelta a la tabla fija de tamano_envio si esto no
 * funciona. Se guarda el JSON crudo de la respuesta (recortado) en
 * calc_product_types.envio_meli_api_razonamiento para poder auditar/ajustar
 * `extraerCostoEnvio()` si las claves no coinciden con la respuesta real.
 */

import { query } from "@/lib/db";

const ML_SITE = "MLA";
const LOGISTIC_TYPE = "fulfillment"; // Mercado Envios Full
const LISTING_TYPE_ID = "gold_special"; // Publicacion Clasica
const OAUTH_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export class MeliAuthError extends Error {}

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

/**
 * Guarda access_token + refresh_token + expiracion en la tabla meli_oauth
 * (fila unica). ML rota el refresh_token en cada uso -- SIEMPRE hay que
 * guardar el nuevo, el viejo deja de servir.
 */
async function guardarTokens(tokens: { access_token: string; refresh_token: string; expires_in: number }) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000 - 60_000); // 1 min de margen
  await query(
    `insert into meli_oauth (id, access_token, refresh_token, expires_at, updated_at)
       values (1, $1, $2, $3, now())
     on conflict (id) do update set
       access_token=$1, refresh_token=$2, expires_at=$3, updated_at=now()`,
    [tokens.access_token, tokens.refresh_token, expiresAt.toISOString()]
  );
}

/**
 * Intercambia el `code` de la autorizacion OAuth por access_token +
 * refresh_token, y los guarda. Se usa desde
 * app/api/calc/meli-oauth/callback/route.ts (paso unico, manual, la
 * primera vez que se conecta la cuenta).
 */
export async function intercambiarCodigoOAuth(code: string, redirectUri: string): Promise<void> {
  const clientId = process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new MeliAuthError("Faltan MELI_CLIENT_ID / MELI_CLIENT_SECRET en las variables de entorno de Vercel.");
  }
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    signal: conTimeout(15_000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new MeliAuthError(`Mercado Libre rechazo el intercambio de codigo (${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  await guardarTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in });
}

/** Refresca el access_token usando el refresh_token guardado. */
async function refrescarAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new MeliAuthError("Faltan MELI_CLIENT_ID / MELI_CLIENT_SECRET en las variables de entorno de Vercel.");
  }
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    signal: conTimeout(15_000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new MeliAuthError(`No se pudo refrescar el token de Mercado Libre (${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  await guardarTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in });
  return data.access_token;
}

/**
 * Devuelve un access_token valido para llamar a la API en nombre de la
 * cuenta de Mercado Libre de Cobus, refrescandolo si esta vencido (o a
 * punto de vencer). Tira MeliAuthError si todavia no se conecto ninguna
 * cuenta (el caller debe caer a la tabla fija en ese caso, ver
 * app/api/calc/run/route.ts).
 */
export async function getAccessToken(): Promise<string> {
  const rows = await query<any>(`select * from meli_oauth where id=1`);
  const row = rows[0];
  if (!row?.refresh_token) {
    throw new MeliAuthError(
      "Todavia no se conecto ninguna cuenta de Mercado Libre. Entra a /api/calc/meli-oauth/authorize para autorizarla."
    );
  }
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expiresAt > Date.now()) {
    return row.access_token;
  }
  return refrescarAccessToken(row.refresh_token);
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
 * listing_prices. Confirmado en produccion (21/07/2026, primera respuesta
 * real obtenida con OAuth) que este endpoint NO devuelve un nodo
 * "shipping" separado -- la doc oficial de MELI ("Costos por vender") solo
 * documenta esta forma de respuesta:
 *   { listing_fee_amount, listing_fee_details: {fixed_fee, gross_amount},
 *     sale_fee_amount, sale_fee_details: {financing_add_on_fee, fixed_fee,
 *     gross_amount, meli_percentage_fee, percentage_fee}, ... }
 * y la doc aclara explicitamente que "fixed_fee" varia segun logistic_type
 * + shipping_modes + billable_weight (por eso son obligatorios) -- es la
 * pieza mas probable para representar el costo de envio dentro de esta
 * llamada. Se dejan los candidatos viejos por si alguna categoria/config
 * distinta si devuelve un nodo shipping. */
function extraerCostoEnvio(data: any): number | null {
  const candidatos = [
    data?.sale_fee_details?.fixed_fee,
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
 * Argentina via `listing_prices`, con la configuracion fija de Cobus
 * (Full + Clasica). Requiere un access_token de la cuenta real de Cobus
 * (ver getAccessToken() -- `logistic_type=fulfillment` devuelve 403 sin
 * autenticacion, confirmado en produccion 20/07/2026). Nunca tira
 * excepcion: en caso de error devuelve `envioArs: null` + `error` para que
 * el caller pueda caer de vuelta a la tabla fija de calc_supuestos.
 */
export async function consultarCostosMeli(params: {
  price: number;
  categoryId: string;
  billableWeightKg: number;
}): Promise<CostosMeliResult> {
  const { price, categoryId, billableWeightKg } = params;
  try {
    const accessToken = await getAccessToken();
    const url =
      `https://api.mercadolibre.com/sites/${ML_SITE}/listing_prices` +
      `?price=${encodeURIComponent(price)}` +
      `&category_id=${encodeURIComponent(categoryId)}` +
      `&listing_type_id=${LISTING_TYPE_ID}` +
      `&logistic_type=${LOGISTIC_TYPE}` +
      `&shipping_modes=me2` +
      `&billable_weight=${encodeURIComponent(billableWeightKg)}`;
    const resp = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: conTimeout(15_000),
    });
    const rawTexto = await resp.text();
    if (!resp.ok) {
      return { envioArs: null, comisionArs: null, rawTexto: rawTexto.slice(0, 1800), error: `API ML respondio ${resp.status}` };
    }
    let data: any;
    try {
      data = JSON.parse(rawTexto);
    } catch {
      return { envioArs: null, comisionArs: null, rawTexto: rawTexto.slice(0, 1800), error: "Respuesta de API ML no es JSON valido" };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      envioArs: extraerCostoEnvio(row),
      comisionArs: extraerComision(row),
      // 1800 chars (antes 500) -- el campo que buscamos (sale_fee_details.fixed_fee)
      // quedaba fuera del recorte anterior, tapando el diagnostico.
      rawTexto: JSON.stringify(row).slice(0, 1800),
    };
  } catch (err: any) {
    return { envioArs: null, comisionArs: null, rawTexto: "", error: String(err?.message ?? err) };
  }
}
