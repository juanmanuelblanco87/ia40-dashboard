import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/calc/meli-oauth/authorize
 *
 * Primer paso del flujo OAuth de Mercado Libre (20/07/2026): redirige a la
 * pantalla de autorizacion de Mercado Libre para que Cobus inicie sesion
 * con SU cuenta y apruebe el acceso. Necesario porque el costo de envio
 * con logistic_type=fulfillment (Mercado Envios Full) devuelve 403 sin
 * autenticacion real de la cuenta (ver lib/meliApi.ts).
 *
 * Requiere MELI_CLIENT_ID en las variables de entorno, y que el
 * redirect_uri de aca abajo este cargado TAL CUAL en la app creada en
 * developers.mercadolibre.com.ar (Configuracion > Redirect URI).
 */
export async function GET(req: Request) {
  const clientId = process.env.MELI_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Falta MELI_CLIENT_ID en las variables de entorno de Vercel. Cargalo y volve a intentar." },
      { status: 500 }
    );
  }
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/calc/meli-oauth/callback`;
  const authUrl =
    `https://auth.mercadolibre.com.ar/authorization?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return NextResponse.redirect(authUrl);
}
