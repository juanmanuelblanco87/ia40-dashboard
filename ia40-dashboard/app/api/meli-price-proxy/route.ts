import { NextResponse } from "next/server";
import { MeliAuthError, getAccessToken } from "@/lib/meliApi";
import { extraerIdMeli, obtenerPrecioItem } from "@/lib/meliItemPrice";

export const dynamic = "force-dynamic";

/**
 * GET /api/meli-price-proxy?url=<link de MeLi>  (o ?id=MLA123456789)
 *
 * Proxy de sólo lectura (25/08/2026) para que OTROS proyectos de Icom
 * Salud consulten un precio real de Mercado Libre usando la cuenta ya
 * conectada acá (ver lib/meliApi.ts), sin necesitar su propio Client
 * ID/Secret ni su propia autorización OAuth -- pedido explícito del
 * usuario ("no puedo acceder al secret"). Primer consumidor: el
 * módulo "Alquileres" de panel-icom-salud (api/alquileres-scrape.js).
 *
 * Excluido del middleware.ts de login (ver su matcher) -- se protege
 * acá mismo con un secreto compartido simple, mismo criterio que ya
 * usa /api/sync con CRON_SECRET. NO es OAuth para quien llama, es
 * confianza servidor-a-servidor entre 2 proyectos de la misma
 * empresa -- cualquiera con MELI_PROXY_SECRET puede consultar precios
 * (nunca escribir ni modificar nada), así que igual conviene tratarlo
 * como un secreto real.
 *
 * Variables de entorno requeridas (además de MELI_CLIENT_ID/
 * MELI_CLIENT_SECRET, que ya existían):
 *   - MELI_PROXY_SECRET: string largo cualquiera (ej. `openssl rand
 *     -hex 32`), el MISMO valor tiene que estar cargado también en
 *     panel-icom-salud como variable de entorno con este mismo
 *     nombre.
 */
export async function GET(req: Request) {
  const expected = process.env.MELI_PROXY_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Falta MELI_PROXY_SECRET en las variables de entorno de Vercel de este proyecto." },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  const url = new URL(req.url);
  const link = url.searchParams.get("url");
  const idParam = url.searchParams.get("id");
  const idMeli = idParam ? idParam.toUpperCase() : link ? extraerIdMeli(link) : null;
  if (!idMeli) {
    return NextResponse.json(
      { ok: false, error: "Falta ?url= (link de MercadoLibre) o ?id= (ej. MLA123456789) válido." },
      { status: 400 }
    );
  }

  // 25/08/2026 (bug reportado: "no funciona traer el precio... es
  // incorrecto que el producto no tenga precio" -- el usuario confirma
  // que SÍ tiene vendedor activo en la web real): modo debug TEMPORAL
  // para ver la respuesta CRUDA de Mercado Libre y diagnosticar sin
  // acceso a los logs de Vercel desde acá -- mismo secreto de siempre,
  // no agrega ninguna superficie nueva de acceso. Sacar una vez
  // resuelto el bug real (ver lib/meliItemPrice.ts).
  if (url.searchParams.get("debug") === "1") {
    try {
      const accessToken = await getAccessToken();
      const [respItem, respProduct] = await Promise.all([
        fetch(`https://api.mercadolibre.com/items/${idMeli}`, { headers: { authorization: `Bearer ${accessToken}` } }),
        fetch(`https://api.mercadolibre.com/products/${idMeli}`, { headers: { authorization: `Bearer ${accessToken}` } }),
      ]);
      const [dataItem, dataProduct] = await Promise.all([
        respItem.json().catch((e) => ({ __parseError: String(e) })),
        respProduct.json().catch((e) => ({ __parseError: String(e) })),
      ]);
      return NextResponse.json({
        ok: true, debug: true, idMeli,
        items: { status: respItem.status, body: dataItem },
        products: { status: respProduct.status, body: dataProduct },
      });
    } catch (err: any) {
      return NextResponse.json({ ok: false, debug: true, error: String(err?.message ?? err) }, { status: 500 });
    }
  }

  try {
    const resultado = await obtenerPrecioItem(idMeli);
    if (resultado.precio == null) {
      return NextResponse.json({ ok: false, error: resultado.error || "No se pudo encontrar el precio." });
    }
    return NextResponse.json({ ok: true, precio: resultado.precio, titulo: resultado.titulo ?? null, metodo: resultado.metodo });
  } catch (err: any) {
    if (err instanceof MeliAuthError) {
      return NextResponse.json({
        ok: false,
        error: "La cuenta de Mercado Libre de ia40-dashboard no está conectada. Entrá a /api/calc/meli-oauth/authorize para conectarla.",
      });
    }
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
