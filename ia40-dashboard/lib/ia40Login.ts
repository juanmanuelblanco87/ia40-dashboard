import chromium from "@sparticuz/chromium-min";
import { chromium as playwrightChromium } from "playwright-core";

// 18/09/2026 ("como lo resolvemos para que sea sostenible? Vercel?"):
// mismo login que hacia refresh_token.py (Playwright + Chrome real) en
// la PC del usuario, pero corriendo en una funcion serverless de Vercel
// -- confirmado en vivo (prueba real via /api/test-ia40-login) que
// Cobus NO bloquea las IPs de datacenter de Vercel, asi que esto
// reemplaza la dependencia de que una PC fisica este encendida (ver
// docs/PROYECTO.md secciones 6/7/15/16).
//
// @sparticuz/chromium-min (no @sparticuz/chromium): el output file
// tracing de Next no detecta los binarios de Chromium (los resuelve
// chromium.executablePath() con fs en runtime, no con require()
// estatico) -- fallaba en Vercel con "input directory .../bin does not
// exist". La variante -min no incluye el binario, lo descarga y cachea
// en /tmp la primera vez desde el pack .tar oficial de la misma
// version, publicado como asset de release en GitHub.
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Oculta las señales mas comunes que delatan un navegador automatizado
// (navigator.webdriver, falta de plugins/chrome.runtime, etc.) -- mismo
// script que ya usaba refresh_token.py (STEALTH_JS).
const STEALTH_JS = `
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
window.chrome = window.chrome || { runtime: {} };
Object.defineProperty(navigator, 'languages', {get: () => ['es-AR', 'es']});
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) => (
  parameters.name === 'notifications' ?
    Promise.resolve({ state: Notification.permission }) :
    originalQuery(parameters)
);
`;

// 18/09/2026 (2do intento, "investiga porque falla el login en Vercel"):
// pasos ahora viaja PEGADO al error -- antes se perdia (la funcion sólo
// lo devolvía en el camino feliz), así que cada falla en el cron dejaba
// cero rastro de en qué paso exacto se cortó.
export class Ia40LoginError extends Error {
  pasos: string[];
  constructor(message: string, pasos: string[] = []) {
    super(message);
    this.pasos = pasos;
  }
}

export interface Ia40LoginResult {
  token: string;
  pasos: string[];
  finalUrl: string;
}

// Login real en cobusgroup.com y captura del JWT de IA40 desde la URL
// de redirect (igual que refresh_token.py -- misma secuencia exacta de
// pasos: click INGRESAR, esperar el iframe de login, completar usuario/
// contraseña, y si el token no llego por la respuesta capturada, ir
// directo a /redirect-ia40).
export async function fetchFreshIa40Token(username: string, password: string): Promise<Ia40LoginResult> {
  const pasos: string[] = [];
  const captured: { token: string | null } = { token: null };
  let loginErrorMsg: string | null = null;

  let browser;
  try {
    // 18/09/2026 (3er intento -- error real obtenido: "net::ERR_INSUFFICIENT_RESOURCES"
    // al hacer goto, con chromium ya lanzado): @sparticuz/chromium-min no
    // incluye --disable-dev-shm-usage entre sus flags por defecto -- en
    // un contenedor serverless /dev/shm suele venir muy chico (64MB), y
    // eso es la causa mas comun y mejor documentada de exactamente este
    // error al cargar una pagina con Chromium headless. Se suma como
    // flag extra (no reemplaza los de chromium.args). También se subio
    // la memoria de esta función a 3009MB en vercel.json -- por defecto
    // podria no alcanzarle a Chromium + Next.js corriendo juntos.
    pasos.push("lanzando chromium");
    browser = await playwrightChromium.launch({
      args: [...chromium.args, "--disable-dev-shm-usage"],
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    });

    // 18/09/2026: sin viewport explicito, Playwright headless usa
    // 800x600 por defecto -- bastante mas chico que un navegador real,
    // lo que puede disparar un layout/JS distinto (menu movil, scripts
    // que esperan un viewport "de escritorio") en un sitio que decide
    // que mostrar segun el tamaño de pantalla.
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "es-AR",
      viewport: { width: 1366, height: 900 },
    });
    await context.addInitScript(STEALTH_JS);
    const page = await context.newPage();

    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("token=") && url.includes("cobusgroup.com") && !captured.token) {
        const match = url.match(/[?&]token=([^&]+)/);
        if (match) captured.token = match[1];
      }
    });

    pasos.push("goto cobusgroup.com");
    await page.goto("https://www.cobusgroup.com/", { waitUntil: "load", timeout: 30000 });

    pasos.push("click INGRESAR");
    await page.click("a.login-link", { timeout: 10000 });

    // 18/09/2026 (2do intento, "investiga porque falla el login en
    // Vercel"): esto fallaba SIEMPRE que lo disparaba el cron pero
    // funcionó en una prueba manual -- la sospecha principal es que un
    // arranque en frio de Chromium en Vercel (bajar+descomprimir el
    // binario) le come tiempo al proceso ANTES de este punto, dejando
    // menos margen para que el sitio inyecte el iframe via JS. Antes
    // esperaba sólo 20×250ms = 5s fijos, sin ningún dato de qué había
    // en la página si fallaba. Ahora: 60×250ms = 15s, y si igual no
    // aparece, se deja un registro real (frames existentes + URL
    // actual) en vez de tirar el error a ciegas.
    pasos.push("esperando iframe de login");
    let loginFrame = null;
    for (let i = 0; i < 60; i++) {
      loginFrame = page.frames().find((f) => f.url().includes("cobus1login")) ?? null;
      if (loginFrame) break;
      await page.waitForTimeout(250);
    }
    if (!loginFrame) {
      const framesVistos = page.frames().map((f) => f.url()).join(" | ") || "(ninguno)";
      pasos.push(`frames en la pagina: ${framesVistos}`);
      pasos.push(`url actual: ${page.url()}`);
      throw new Ia40LoginError(
        "No aparecio el iframe de login (cobus1login.html) tras clickear INGRESAR.",
        pasos
      );
    }

    pasos.push("completando usuario/contrasena");
    await loginFrame.fill("#login1", username);
    await loginFrame.fill("#pass", password);
    await loginFrame.click("a[onclick='funcion()']");

    pasos.push("esperando resultado del login");
    await page.waitForTimeout(4000);

    if (loginErrorMsg) {
      throw new Ia40LoginError(loginErrorMsg, pasos);
    }

    if (!captured.token) {
      pasos.push("goto redirect-ia40");
      try {
        await page.goto("https://www.cobusgroup.com/redirect-ia40", { waitUntil: "load", timeout: 20000 });
      } catch {
        // seguimos aunque falle -- puede que el token ya se haya capturado por la respuesta
      }
      await page.waitForTimeout(2000);
    }

    const finalUrl = page.url();
    await browser.close();

    if (!captured.token) {
      throw new Ia40LoginError(`No se pudo capturar el token despues del login. Ultima URL: ${finalUrl}`, pasos);
    }

    pasos.push("token capturado");
    return { token: captured.token, pasos, finalUrl };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    if (err instanceof Ia40LoginError) {
      if (!err.pasos?.length) err.pasos = pasos;
      throw err;
    }
    throw new Ia40LoginError(String((err as any)?.message ?? err), pasos);
  }
}
