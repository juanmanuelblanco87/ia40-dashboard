/**
 * Consulta de precio de un ítem/producto puntual de Mercado Libre por
 * su id (MLA...), usando la cuenta ya conectada (ver lib/meliApi.ts).
 *
 * 25/08/2026 -- pedido del usuario: el módulo "Alquileres" del panel
 * unificado de ICOM Salud (proyecto separado, panel-icom-salud)
 * necesita leer precios reales de MercadoLibre para referenciar sus
 * precios de alquiler, pero no tiene su propio Client ID/Secret de
 * MeLi ("no puedo acceder al secret"). En vez de duplicar el OAuth
 * ahí, este archivo agrega la consulta de precio-por-id que
 * lib/meliApi.ts todavía no tenía (ese archivo sólo calculaba costo
 * de envío), y api/meli-price-proxy/route.ts la expone como un proxy
 * de sólo lectura protegido por un secreto compartido simple (no es
 * OAuth para el caller, sólo confianza servidor-a-servidor entre 2
 * proyectos de la misma empresa).
 *
 * Deliberadamente en un archivo NUEVO, no agregado a meliApi.ts --
 * mismo criterio que ya sigue ese archivo consigo mismo (ver el
 * comentario de lib/pvpFinder.ts en docs/PROYECTO.md): no tocar
 * código ya probado en producción si se puede evitar.
 */
import { getAccessToken } from "@/lib/meliApi";

/** Extrae el id de MeLi (MLA123456789) de una URL de producto/ítem
 * real -- 3 formatos vistos en uso: ".../p/MLA36197464" (página de
 * PRODUCTO, catálogo agregado de varios vendedores), ".../up/
 * MLAU3559050907" (página de producto de catálogo "unificado", nota
 * el prefijo MLAU en vez de MLA) y ".../MLA-123456789-..." (página de
 * un ÍTEM/publicación puntual). Cada uno usa un endpoint distinto de
 * la API (ver obtenerPrecioItem).
 *
 * 27/08/2026 (bug reportado, "funcionaba ayer... URL con /up/
 * MLAU3559050907 y wid=MLA2571695282 en la query de tracking del
 * buscador de MercadoLibre"): el formato /up/MLAU... no estaba
 * contemplado, así que caía siempre al fallback genérico MLA-?\d{6,},
 * que corría sobre la URL COMPLETA -- incluida la query string. Esa
 * URL real trae "wid=MLA2571695282" (el id de un widget de resultados
 * de búsqueda, sin relación con el producto) en la query, y el
 * fallback lo tomaba por error en vez del id real del producto
 * (MLAU3559050907, en el path). Fix: 1) reconocer /up/MLAU..., 2)
 * limitar el fallback genérico a sólo el PATH de la URL (nunca query
 * ni fragment) -- un id de producto real siempre vive en el path,
 * nunca en un parámetro de tracking. */
export function extraerIdMeli(url: string): string | null {
  const up = url.match(/\/up\/(MLAU?\d+)/i);
  if (up) return up[1].toUpperCase();

  const p = url.match(/\/p\/(MLA\d+)/i);
  if (p) return p[1].toUpperCase();

  let pathname = url;
  try { pathname = new URL(url).pathname; } catch (e) { /* URL rara -- se sigue con el string completo, mismo comportamiento de antes */ }
  const generico = pathname.match(/MLA-?(\d{6,})/i);
  if (!generico) return null;
  const raw = generico[1].toUpperCase();
  return raw.startsWith("MLA") ? raw : `MLA${raw}`;
}

export interface PrecioItemResult {
  precio: number | null;
  titulo?: string | null;
  metodo?: string;
  error?: string;
}

/** Prueba primero /items/{id} (publicación puntual); si da 404
 * (típico cuando el link era de producto de catálogo, no de un
 * ítem), reintenta como producto de catálogo. Nunca tira excepción por
 * un precio no encontrado -- MeliAuthError (cuenta no conectada) sí se
 * deja propagar, el caller la maneja.
 *
 * 25/08/2026 (bug reportado con captura: "no funciona traer el precio
 * de mercado Libre y es incorrecto que el producto no tenga precio" --
 * el usuario confirmó que el producto SÍ tenía vendedor activo en la
 * web real): la primera versión de esta función leía
 * `buy_box_winner.price` de GET /products/{id} para el caso de
 * catálogo -- confirmado en vivo con el modo ?debug=1 de
 * app/api/meli-price-proxy/route.ts que ese campo viene `null` en la
 * práctica (al menos para este producto, con esta cuenta), aunque el
 * producto SÍ tenía 2 vendedores activos con precio real.
 *
 * 27/08/2026 (2do bug reportado, "esta mal 30.000... chequea la web" --
 * la página real mostraba $49.999): el fix anterior tomaba el precio
 * MÁS BAJO entre los vendedores activos de GET /products/{id}/items,
 * asumiendo que "el más barato real" alcanzaba -- pero eso también
 * puede ser un vendedor distinto al que la página le muestra a un
 * comprador por defecto (el "ganador de la buybox"). El usuario pidió
 * explícitamente traer al ganador, no adivinar: "porque siempre son
 * publicaciones de catálogo, sino no tiene sentido pegarle a la api si
 * tengo que colocar a mano el numero". La pieza que faltaba: aunque
 * `buy_box_winner.price` vino null la vez que se probó, el ID del
 * ítem ganador (`buy_box_winner_item_id`, o anidado en
 * `buy_box_winner.item_id` según la versión de la respuesta) SÍ debería
 * venir poblado -- y con ese id se puede pedir el precio real y
 * confiable por el mismo endpoint /items/{id} que ya se usa arriba
 * para links directos de ítem (ese SÍ devuelve precio consistentemente).
 * Sólo si no hay ganador identificable Y hay más de un precio activo
 * distinto se cae al aviso de ambigüedad (no inventar un número). */
export async function obtenerPrecioItem(idMeli: string): Promise<PrecioItemResult> {
  const accessToken = await getAccessToken(); // puede tirar MeliAuthError, se propaga
  const headers = { authorization: `Bearer ${accessToken}` };

  const resp = await fetch(`https://api.mercadolibre.com/items/${idMeli}`, { headers });
  if (resp.ok) {
    const data = await resp.json();
    if (typeof data.price === "number" && data.price > 0) {
      return { precio: Math.round(data.price), titulo: data.title ?? null, metodo: "meli-api" };
    }
  }

  const [respProducto, respItemsActivos] = await Promise.all([
    fetch(`https://api.mercadolibre.com/products/${idMeli}`, { headers }),
    fetch(`https://api.mercadolibre.com/products/${idMeli}/items?status=active`, { headers }),
  ]);

  if (!respProducto.ok && !respItemsActivos.ok) {
    return { precio: null, error: `Mercado Libre no encontró ${idMeli} (probado como ítem y como producto de catálogo).` };
  }

  const dataProducto = respProducto.ok ? await respProducto.json().catch(() => null) : null;
  const titulo = dataProducto?.name ?? null;

  // Ganador de la buybox: se sigue su item_id hasta /items/{id} en vez
  // de confiar en el precio embebido de /products/{id} (ese campo vino
  // null la vez anterior que se lo probó).
  const winnerItemId: string | undefined =
    dataProducto?.buy_box_winner?.item_id || dataProducto?.buy_box_winner_item_id;
  if (winnerItemId) {
    const respGanador = await fetch(`https://api.mercadolibre.com/items/${winnerItemId}`, { headers });
    if (respGanador.ok) {
      const dataGanador = await respGanador.json();
      if (typeof dataGanador.price === "number" && dataGanador.price > 0) {
        return { precio: Math.round(dataGanador.price), titulo: dataGanador.title ?? titulo, metodo: "meli-api" };
      }
    }
  }

  if (respItemsActivos.ok) {
    const dataItems = await respItemsActivos.json();
    const activos: any[] = (dataItems?.results || []).filter((r: any) => typeof r?.price === "number" && r.price > 0);
    if (activos.length) {
      const precios = activos.map((r) => r.price);
      const min = Math.min(...precios);
      const max = Math.max(...precios);
      if (min === max) {
        return { precio: Math.round(min), titulo, metodo: "meli-api" };
      }
      // No se pudo identificar al ganador de la buybox (vino vacío, o
      // su item no tenía precio) y hay varios precios activos
      // distintos -- no inventar un número, avisar el rango real.
      return {
        precio: null,
        titulo,
        error: `Este producto tiene ${activos.length} vendedores activos con precios distintos (entre $${Math.round(min).toLocaleString("es-AR")} y $${Math.round(max).toLocaleString("es-AR")}) -- no se pudo identificar automáticamente cuál es el vendedor destacado. Revisá la página real y cargá el precio a mano.`,
      };
    }
  }

  return { precio: null, titulo, error: "Este producto de MercadoLibre no tiene ningún vendedor activo con precio en este momento." };
}
