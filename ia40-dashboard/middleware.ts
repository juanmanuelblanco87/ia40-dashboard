import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Portal de acceso (21/07/2026) -- pedido explicito del usuario: "Tenemos
 * que hacer un portal de ingreso para limitar los accesos de cualquier
 * persona con acceso al link". Mismo patron simple que ya usaban en otro
 * proyecto de Icom Salud (usuario/contraseña COMPARTIDOS entre todo el
 * equipo, sin cuentas individuales) -- ver `icom_panel_unificado.html`
 * que subio el usuario como referencia (`const USERS = {'icom':'2026'}`,
 * chequeo 100% en el navegador con sessionStorage).
 *
 * Diferencia importante con esa referencia: ahi el chequeo era SOLO del
 * lado del cliente (bastaba ver "Ver codigo fuente" para encontrar la
 * contraseña en texto plano, o escribir una linea en la consola del
 * navegador para saltearselo). Este middleware corre en el SERVIDOR antes
 * de renderizar cualquier pagina o responder cualquier API -- la
 * contraseña vive solo en variables de entorno de Vercel, nunca en el
 * codigo ni llega al navegador.
 *
 * Variables de entorno requeridas (Vercel, Production):
 *   - AUTH_USERS: JSON con los usuarios permitidos, ej. {"icom":"2026"}
 *   - AUTH_SESSION_TOKEN: un string largo cualquiera (ej. generado con
 *     `openssl rand -hex 32`) -- es el valor que se guarda en la cookie
 *     despues de un login correcto. No hace falta que signifique nada,
 *     solo que sea dificil de adivinar.
 *
 * Si AUTH_SESSION_TOKEN no esta configurado, el middleware deja pasar
 * todo sin bloquear (para no dejar la app inaccesible por un olvido de
 * configuracion) -- pero hay que configurarlo cuanto antes.
 *
 * IMPORTANTE -- rutas que NUNCA deben quedar atras del login porque las
 * llama un tercero, no un navegador logueado (ver `matcher` mas abajo):
 *   - /api/sync, /api/sync-images: dispara el cron de Vercel.
 *   - /api/calc/meli-oauth/*: Mercado Libre redirige al callback despues
 *     de autorizar -- si quedara atras del gate, se rompe la conexion.
 *   - /api/calc/meli-webhook: Mercado Libre manda notificaciones ahi
 *     directamente.
 *   - archivos estaticos (imagenes, _next, etc.) -- si no, ni el logo de
 *     la propia pantalla de login cargaria.
 */
export function middleware(req: NextRequest) {
  const expected = process.env.AUTH_SESSION_TOKEN;
  if (!expected) return NextResponse.next();

  const cookie = req.cookies.get("icom_auth")?.value;
  if (cookie === expected) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Excluye /login, /api/login, las rutas que llama Mercado Libre/el cron
  // directamente, y cualquier archivo estatico (cualquier ruta con un
  // "." -- imagenes, _next/static, etc.).
  matcher: [
    "/((?!login|api/login|api/sync|api/sync-images|api/calc/meli-oauth|api/calc/meli-webhook|.*\\..*).*)",
  ],
};
