import { NextResponse } from "next/server";
import { intercambiarCodigoOAuth, MeliAuthError } from "@/lib/meliApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/calc/meli-oauth/callback
 *
 * Segundo paso del flujo OAuth de Mercado Libre (20/07/2026): Mercado
 * Libre redirige aca con `?code=...` despues de que Cobus aprueba el
 * acceso en /api/calc/meli-oauth/authorize. Intercambia ese codigo por un
 * access_token + refresh_token (se guardan en la tabla meli_oauth, ver
 * lib/meliApi.ts) y vuelve a la pagina del calculador con un mensaje de
 * resultado en la URL (`?meli_oauth=ok` o `?meli_oauth=error&msg=...`).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/calculo-importacion?meli_oauth=error&msg=${encodeURIComponent("Falta el codigo de autorizacion")}`);
  }

  try {
    const redirectUri = `${origin}/api/calc/meli-oauth/callback`;
    await intercambiarCodigoOAuth(code, redirectUri);
    return NextResponse.redirect(`${origin}/calculo-importacion?meli_oauth=ok`);
  } catch (err: any) {
    const msg = err instanceof MeliAuthError ? err.message : String(err?.message ?? err);
    return NextResponse.redirect(`${origin}/calculo-importacion?meli_oauth=error&msg=${encodeURIComponent(msg)}`);
  }
}
