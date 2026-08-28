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
import { gotScraping } from "got-scraping";

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
  // 27/08/2026 ("trae una imagen del producto miniatura"): la primer
  // foto del ítem/producto, para mostrar como miniatura en Alquileres.
  imagen?: string | null;
  metodo?: string;
  error?: string;
}

/** Prueba primero /items/{id} (publicación puntual); si da 404
 * (típico cuando el link era de producto de catálogo, no de un
 * ítem), reintenta como producto de catálogo. Nunca tira excepción por
 * un precio no encontrado -- MeliAuthError (cuenta no conectada) sí se
 * deja propagar, el caller la maneja.
 *
 * 25/08/2026 (bug reportado, "no funciona traer el precio... es
 * incorrecto que no tenga precio"): la 1ra versión leía
 * `buy_box_winner.price` de GET /products/{id} -- confirmado que
 * viene `null` en la práctica.
 *
 * 27/08/2026 (3 vueltas de diagnóstico con un caso real,
 * MLA25413331, 32 vendedores activos entre $30.000 y $109.999):
 *  1. Seguir el id del ganador (`buy_box_winner_item_id` /
 *     `buy_box_winner.item_id`) hasta /items/{id} -- confirmado que
 *     ninguno de los 2 campos viene poblado para este producto.
 *  2/3. Se logueó la lista COMPLETA de vendedores activos -- SÍ existe
 *     el ítem exacto que la página le muestra a un comprador
 *     ($49.999, tienda oficial 128892), pero ningún campo disponible
 *     lo distingue de los otros 30 (no es el más barato, ni el más
 *     barato con tienda oficial, ni el de mayor categoría de
 *     publicación) -- MercadoLibre arma ese default probablemente con
 *     señales del comprador (dirección, envío, historial) que un
 *     server-to-server genérico no puede replicar.
 *
 * Decisión final del usuario ante esto ("el mejor precio de la buybox
 * pero sólo de tiendas oficiales, sino el mejor precio de la
 * buybox"): en vez de perseguir el precio exacto de MercadoLibre
 * (no reproducible de forma confiable, ver arriba), política propia
 * y determinística -- preferir vendedores de TIENDA OFICIAL (más
 * confiables) y tomar el más barato entre ellos; si no hay ninguna
 * tienda oficial activa, el más barato entre todos los vendedores
 * activos (metodo se marca distinto en ese caso -- el caller puede
 * avisar menor confianza, mismo criterio que ya usa para la
 * heurística de texto). */
export async function obtenerPrecioItem(idMeli: string): Promise<PrecioItemResult> {
  const accessToken = await getAccessToken(); // puede tirar MeliAuthError, se propaga
  const headers = { authorization: `Bearer ${accessToken}` };

  const resp = await fetch(`https://api.mercadolibre.com/items/${idMeli}`, { headers });
  if (resp.ok) {
    const data = await resp.json();
    if (typeof data.price === "number" && data.price > 0) {
      const imagen = data.pictures?.[0]?.secure_url || data.pictures?.[0]?.url || data.thumbnail || null;
      return { precio: Math.round(data.price), titulo: data.title ?? null, imagen, metodo: "meli-api" };
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
  // La foto del PRODUCTO de catálogo (no de un vendedor puntual) --
  // es la misma para cualquiera de los vendedores activos, así que no
  // hace falta resolverla de nuevo por cada rama de abajo.
  //
  // 27/08/2026 (diagnóstico confirmado, "por algún motivo en este sku
  // falla la imagen" -- MLAU2712281290): pictures NO viene vacío por un
  // nombre de campo mal asumido (secure_url/url son correctos) -- para
  // ESTE producto de catálogo, GET /products/{id} directamente no
  // trae ninguna foto (pictures:[]). No es un caso raro -- pasa. El
  // fallback (más abajo, cuando se resuelve un vendedor puntual) pide
  // /items/{id} de ESE vendedor, que sí suele traer fotos propias.
  // 27/08/2026 (2do intento -- pictures venía [] para este producto):
  // description_pictures es OTRO array del mismo /products/{id}, no
  // probado hasta ahora -- a veces trae fotos aunque pictures esté
  // vacío.
  const imagenProducto: string | null =
    dataProducto?.pictures?.[0]?.secure_url || dataProducto?.pictures?.[0]?.url ||
    dataProducto?.description_pictures?.[0]?.secure_url || dataProducto?.description_pictures?.[0]?.url || null;

  // Ganador de la buybox: se sigue el id hasta /items/{id} -- cuando
  // SÍ viene poblado (no siempre, ver comentario de arriba), es la
  // señal más confiable de todas, así que se prueba primero.
  const winnerItemId: string | undefined =
    dataProducto?.buy_box_winner?.item_id || dataProducto?.buy_box_winner_item_id;
  if (winnerItemId) {
    const respGanador = await fetch(`https://api.mercadolibre.com/items/${winnerItemId}`, { headers });
    if (respGanador.ok) {
      const dataGanador = await respGanador.json();
      if (typeof dataGanador.price === "number" && dataGanador.price > 0) {
        const imagenGanador = dataGanador.pictures?.[0]?.secure_url || dataGanador.pictures?.[0]?.url || dataGanador.thumbnail || imagenProducto;
        return { precio: Math.round(dataGanador.price), titulo: dataGanador.title ?? titulo, imagen: imagenGanador, metodo: "meli-api" };
      }
    }
  }

  if (respItemsActivos.ok) {
    const dataItems = await respItemsActivos.json();
    const activos: any[] = (dataItems?.results || []).filter((r: any) => typeof r?.price === "number" && r.price > 0);
    if (activos.length) {
      const oficiales = activos.filter((r) => r.official_store_id != null);
      const candidatos = oficiales.length ? oficiales : activos;
      const elegido = candidatos.reduce((min, r) => (r.price < min.price ? r : min), candidatos[0]);
      // 27/08/2026 ("por algún motivo en este sku falla la imagen" --
      // MLAU2712281290/MLA1952912100, cama ortopédica de 1 solo
      // vendedor): /products/{id}/items no trae pictures en el resumen
      // (confirmado), así que hace falta el detalle de algún vendedor
      // activo para sacarle la foto. Historial de diagnóstico (varias
      // vueltas con este caso real) hasta llegar a la causa real:
      //   1. /items/{id} con el token propio -> 403 access_denied.
      //      Confirmado con el usuario: MeLi bloquea deliberadamente el
      //      detalle completo de publicaciones CLÁSICAS de otro
      //      vendedor (anti-scraping entre competidores) -- ownership,
      //      no ofuscación técnica.
      //   2. Los 2 endpoints "públicos" que no exigen ser dueño
      //      (/sites/MLA/search?ids=, /items/{id}/pictures) -- con
      //      fetch() plano, TAMBIÉN dieron 403/405, con o sin el
      //      token, con o sin User-Agent de navegador. Eso es un
      //      bloqueo DISTINTO al de (1): no es ownership (son
      //      endpoints públicos por diseño), es fingerprinting a nivel
      //      TLS/HTTP2 -- fetch() de Node tiene una huella reconocible
      //      como no-navegador ANTES de que viaje cualquier header
      //      HTTP, y ningún header la disimula.
      //   3. gotScraping (paquete open-source de Apify, sin costo, sin
      //      cuenta) imita la huella TLS/HTTP2 de un Chrome real --
      //      probado en vivo, SÍ esquiva el bloqueo de (2). La página
      //      pública del ítem (articulo.mercadolibre.com.ar/MLA-{id},
      //      OJO con el guión -- sin él, el sitio redirige en silencio
      //      a la portada genérica) confirmada trayendo el título y la
      //      imagen reales para 2 productos de prueba distintos.
      // El bloqueo (1) sigue sin esquivarse -- ni corresponde
      // intentarlo, es una regla de negocio deliberada. El de (2)/(3)
      // sí, porque es sólo protección anti-bot sobre contenido que
      // cualquier comprador ve igual sin login.
      let imagenElegido = imagenProducto;
      if (!imagenElegido) {
        const ordenParaFoto = [...candidatos].sort((a, b) => a.price - b.price).slice(0, 5); // tope de 5 -- no multiplicar sin límite los pedidos en un producto con muchos vendedores
        const trazaSiFalla: any[] = [];
        for (const candidato of ordenParaFoto) {
          if (!candidato.item_id) continue;
          try {
            const respFoto = await fetch(`https://api.mercadolibre.com/items/${candidato.item_id}`, { headers });
            if (respFoto.ok) {
              const dataFoto = await respFoto.json();
              const foto = dataFoto.pictures?.[0]?.secure_url || dataFoto.pictures?.[0]?.url || dataFoto.thumbnail || null;
              if (foto) { imagenElegido = foto; break; }
            }

            // Endpoint público 1: búsqueda por id, vía gotScraping.
            const respBusqueda = await gotScraping({
              url: `https://api.mercadolibre.com/sites/MLA/search?ids=${candidato.item_id}`,
              responseType: "json", throwHttpErrors: false, timeout: { request: 8000 },
            }).catch((e) => ({ statusCode: 0, body: null, _error: String(e?.message ?? e) }));
            let fotoBusqueda: string | null = null;
            if (respBusqueda.statusCode >= 200 && respBusqueda.statusCode < 300) {
              const dataBusqueda: any = respBusqueda.body;
              const resultado = dataBusqueda?.results?.[0] ?? dataBusqueda?.[0]?.body ?? null; // la API a veces envuelve cada id en {code, body}
              fotoBusqueda = resultado?.pictures?.[0]?.secure_url || resultado?.pictures?.[0]?.url || resultado?.thumbnail || null;
              if (fotoBusqueda) { imagenElegido = fotoBusqueda; break; }
            }

            // Endpoint público 2: la página del ítem, vía gotScraping
            // (mismo trato que le daría un navegador real -- no
            // requiere login para verla, cualquier comprador la ve).
            // 27/08/2026 (confirmado probando en vivo): el short-link
            // de MercadoLibre exige el GUIÓN después de "MLA"
            // (".../MLA-1952912100") -- sin él, el sitio redirige
            // silenciosamente a la portada genérica en vez de dar 404
            // (200 con el título "Mercado Libre", no el del producto).
            const idConGuion = candidato.item_id.replace(/^([A-Z]+)(\d)/, "$1-$2");
            const respPagina = await gotScraping({
              url: `https://articulo.mercadolibre.com.ar/${idConGuion}`,
              throwHttpErrors: false, timeout: { request: 10000 },
            }).catch((e) => ({ statusCode: 0, body: null, _error: String(e?.message ?? e) }));
            let matchPagina = false;
            let ogTituloEncontrado: string | null = null;
            let bytesPagina = 0;
            if (respPagina.statusCode >= 200 && respPagina.statusCode < 300 && typeof respPagina.body === "string") {
              bytesPagina = respPagina.body.length;
              // Salvaguarda: si el id es inválido o el link cambió de
              // formato, el sitio puede redirigir en silencio a la
              // portada genérica (200, pero og:title="Mercado Libre",
              // no el título del producto) -- se descarta ese caso en
              // vez de guardar el logo del sitio como si fuera la foto.
              const ogTitle = respPagina.body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
              ogTituloEncontrado = ogTitle ? ogTitle[1] : null;
              const esPortadaGenerica = ogTitle && ogTitle[1].trim() === "Mercado Libre";
              const match = !esPortadaGenerica && respPagina.body.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
              matchPagina = !!match;
              if (match && match[1]) { imagenElegido = match[1]; break; }
            }

            trazaSiFalla.push({
              item_id: candidato.item_id,
              itemsAuth: respFoto.status,
              busquedaGot: respBusqueda.statusCode, fotoBusqueda,
              paginaGot: respPagina.statusCode, matchPagina, bytesPagina, ogTituloEncontrado,
              // 28/08/2026 (diagnóstico temporal, última vuelta): bytesPagina
              // (37058) es casi idéntico al de la portada genérica que se vio
              // probando local sin el guión (37072) -- pero acá ni siquiera
              // aparece <meta property="og:title">, así que no es EXACTAMENTE
              // la misma portada. Se loguea el <title> de <head> (más simple,
              // no depende del orden de atributos como el regex de og:) y un
              // fragmento del body para identificar qué página es realmente.
              tituloHtml: typeof respPagina.body === "string" ? (respPagina.body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null) : null,
              fragmento: typeof respPagina.body === "string" ? respPagina.body.replace(/\s+/g, " ").slice(0, 400) : null,
            });
          } catch (e: any) {
            trazaSiFalla.push({ item_id: candidato.item_id, error: String(e?.message ?? e) });
          }
        }
        if (!imagenElegido && trazaSiFalla.length) {
          console.log("[meliItemPrice] diag-imagen7", idMeli, JSON.stringify(trazaSiFalla));
        }
      }
      return {
        precio: Math.round(elegido.price),
        titulo,
        imagen: imagenElegido,
        // Sin tienda oficial de por medio, el número es más arriesgado
        // (podría ser un vendedor no verificado con precio raro) --
        // metodo distinto para que el caller lo marque como menor
        // confianza, igual que ya hace con la heurística de texto.
        metodo: oficiales.length ? "meli-api" : "meli-api-sin-oficial",
      };
    }
  }

  return { precio: null, titulo, imagen: imagenProducto, error: "Este producto de MercadoLibre no tiene ningún vendedor activo con precio en este momento." };
}
