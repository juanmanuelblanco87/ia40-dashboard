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
 * ítem), reintenta con /products/{id} (API de Catálogo, estructura de
 * respuesta distinta -- el precio vive en buy_box_winner.price cuando
 * hay un "ganador" activo). Nunca tira excepción por un precio no
 * encontrado -- MeliAuthError (cuenta no conectada) sí se deja
 * propagar, el caller la maneja. */
export async function obtenerPrecioItem(idMeli: string): Promise<PrecioItemResult> {
  const accessToken = await getAccessToken(); // puede tirar MeliAuthError, se propaga

  const resp = await fetch(`https://api.mercadolibre.com/items/${idMeli}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (resp.ok) {
    const data = await resp.json();
    if (typeof data.price === "number" && data.price > 0) {
      return { precio: Math.round(data.price), titulo: data.title ?? null, metodo: "meli-api" };
    }
  }

  const resp2 = await fetch(`https://api.mercadolibre.com/products/${idMeli}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (resp2.ok) {
    const data2 = await resp2.json();
    const precio = data2?.buy_box_winner?.price;
    if (typeof precio === "number" && precio > 0) {
      return { precio: Math.round(precio), titulo: data2.name ?? null, metodo: "meli-api" };
    }
    return { precio: null, error: "Este producto de MercadoLibre no tiene ningún vendedor activo con precio (buy_box vacío)." };
  }

  return { precio: null, error: `Mercado Libre no encontró ${idMeli} (probado como ítem y como producto de catálogo).` };
}
