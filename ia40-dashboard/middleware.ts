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
 *   - /api/meli-sellout-snapshot (01/09/2026): idem, otro cron de
 *     Vercel (snapshot diario de sell-out de Mercado Libre).
 *   - /api/calc/meli-oauth/*: Mercado Libre redirige al callback despues
 *     de autorizar -- si quedara atras del gate, se rompe la conexion.
 *   - /api/calc/meli-webhook: Mercado Libre manda notificaciones ahi
 *     directamente.
 *   - /api/meli-price-proxy: lo llama OTRO proyecto de Icom Salud
 *     (panel-icom-salud, servidor a servidor) -- no lleva la cookie de
 *     este login, se protege con su propio secreto compartido
 *     (MELI_PROXY_SECRET, ver ese route.ts).
 *   - /api/rental-price-ai (01/09/2026): mismo caso exacto que
 *     meli-price-proxy -- panel-icom-salud (botón "🤖 Consultar IA" de
 *     Alquileres) le pega server-a-servidor, mismo MELI_PROXY_SECRET
 *     reusado (ver ese route.ts).
 *   - /api/token: lo llama refresh_token.py, un script que corre en una
 *     PC (Programador de tareas de Windows, cada ~10 min) para mantener
 *     actualizado el token de IA40/Cobus -- tampoco lleva la cookie de
 *     este login, se protege con SU propio secreto (TOKEN_UPDATE_SECRET,
 *     ver ese route.ts). 26/08/2026 ("me sigue pidiendo el login viejo"
 *     no, esto era otra cosa -- "el modulo de importaciones devuelve
 *     vacio"): faltaba acá desde que se agregó este middleware
 *     (21/07/2026) -- por eso ningún token nuevo se guardaba desde
 *     entonces, sin importar qué TOKEN_UPDATE_SECRET tuviera el script:
 *     el middleware lo rechazaba con 401 ANTES de que la ruta llegara a
 *     chequear ese secreto.
 *   - archivos estaticos (imagenes, _next, etc.) -- si no, ni el logo de
 *     la propia pantalla de login cargaria.
 *
 * Auto-login desde panel-icom-salud (25/08/2026, "Quedo un doble
 * ingreso, quita el 2do en importaciones"): panel-icom-salud YA exige
 * su propio login antes de mostrar este proyecto en un iframe (sólo
 * Admin/Gerente, roles firmados de verdad -- ver
 * loadImportacionesLogin() ahí) -- pedir ACÁ un 2do usuario/contraseña
 * compartido es redundante. En vez de sacar la protección de este
 * proyecto (quedaría accesible sin login a cualquiera que tenga la URL,
 * entre por el panel o no), panel-icom-salud manda un token PROPIO y
 * SEPARADO (`PANEL_ACCESS_TOKEN` -- nunca AUTH_SESSION_TOKEN ni una
 * contraseña real) como query param `?panelAuth=` la primera vez que
 * crea el iframe -- si coincide, esto deja pasar la request Y de paso
 * intenta guardar la MISMA cookie de siempre. Variable de entorno
 * nueva: PANEL_ACCESS_TOKEN (mismo valor configurado en
 * panel-icom-salud, ver api/importaciones-token.js ahí -- ese endpoint
 * sólo lo entrega a quien ya pasó SU login).
 *
 * 26/08/2026 ("en mobile me sigue pidiendo usuario y pass, probé 3
 * veces"): ANTES, con panelAuth válido, esto hacía un redirect a la
 * URL limpia (sacando el token) Y RECIÉN AHÍ dependía de que la cookie
 * ya hubiera quedado guardada para la request SIGUIENTE (la del
 * redirect). En un iframe cross-origin en mobile, el navegador puede
 * bloquear esa cookie como "de terceros" -- la respuesta manda
 * Set-Cookie igual, pero el navegador la descarta silenciosamente. La
 * request del redirect llegaba entonces SIN cookie ni panelAuth (el
 * redirect se lo sacó) -- ningún dato para autenticar, pantalla de
 * login de nuevo, sin importar cuántas veces se reintentara. Fix: con
 * panelAuth válido se deja pasar la request ACTUAL directo (sin
 * redirect de por medio) -- la cookie se sigue intentando guardar,
 * como ayuda para navegación futura en navegadores que sí la acepten,
 * pero YA NO hace falta que persista para que ESTA carga funcione.
 *
 * 26/08/2026 (2da vuelta, "ingreso pero no carga nada de info"): la
 * carga inicial ya no dependía de la cookie, pero los ~15 fetch()
 * sueltos que hace la app DESPUÉS (categorías, datos, etc., todos a
 * /api/*) sí dependían pura y exclusivamente de que el navegador
 * mandara esa cookie solo -- bloqueada, esos pedidos volvían 401 y la
 * pantalla quedaba vacía aunque la página en sí hubiera cargado bien.
 * Se agrega un header propio (x-panel-auth) como alternativa a la
 * cookie en CUALQUIER request, no sólo la inicial -- ver
 * app/layout.tsx (PANEL_AUTH_BOOTSTRAP), que guarda el token de
 * panelAuth en sessionStorage (del propio iframe, no depende de la
 * política de cookies de terceros) y parchea window.fetch una sola
 * vez para mandar ese header en TODO pedido. */
export function middleware(req: NextRequest) {
  const expected = process.env.AUTH_SESSION_TOKEN;
  if (!expected) return NextResponse.next();

  const panelAccessToken = process.env.PANEL_ACCESS_TOKEN;
  const panelToken = req.nextUrl.searchParams.get("panelAuth") || req.headers.get("x-panel-auth");
  if (panelToken && panelAccessToken && panelToken === panelAccessToken) {
    const res = NextResponse.next();
    // sameSite:"none" (a diferencia de "lax" en api/login/route.ts) --
    // esta cookie sigue siendo un plus para navegadores que sí aceptan
    // cookies de terceros (ej. clickear "Cálculo de Importación", una
    // navegación de página completa que no pasa por window.fetch
    // parcheado) -- pero ya ninguna carga depende de que persista.
    res.cookies.set("icom_auth", expected, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  }

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
    "/((?!login|api/login|api/sync|api/sync-images|api/meli-sellout-snapshot|api/calc/meli-oauth|api/calc/meli-webhook|api/meli-price-proxy|api/rental-price-ai|api/token|.*\\..*).*)",
  ],
};
