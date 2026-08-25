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
 * real -- ambos formatos vistos en uso: ".../p/MLA36197464" (página
 * de PRODUCTO, catálogo agregado de varios vendedores) y
 * ".../MLA-123456789-..." (página de un ÍTEM/publicación puntual).
 * Cada uno usa un endpoint distinto de la API (ver obtenerPrecioItem). */
export function extraerIdMeli(url: string): string | null {
  const m = url.match(/\/p\/(MLA\d+)/i) || url.match(/MLA-?(\d{6,})/i);
  if (!m) return null;
  const raw = m[1].toUpperCase();
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
 * producto SÍ tenía 2 vendedores activos con precio real. El dato
 * correcto sale de GET /products/{id}/items?status=active -- la misma
 * lista de "ítems que compiten por este producto" que arma la página
 * pública -- de ahí se toma el precio más bajo entre los activos (no
 * asumir que el primero del array es el ganador; más robusto tomar el
 * mínimo real). */
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

  const titulo = respProducto.ok ? ((await respProducto.json())?.name ?? null) : null;

  if (respItemsActivos.ok) {
    const dataItems = await respItemsActivos.json();
    const activos: any[] = (dataItems?.results || []).filter((r: any) => typeof r?.price === "number" && r.price > 0);
    if (activos.length) {
      const masBarato = activos.reduce((min, r) => (r.price < min.price ? r : min), activos[0]);
      return { precio: Math.round(masBarato.price), titulo, metodo: "meli-api" };
    }
  }

  return { precio: null, error: "Este producto de MercadoLibre no tiene ningún vendedor activo con precio en este momento." };
}
