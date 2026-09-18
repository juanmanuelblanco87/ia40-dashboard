import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 18/09/2026 ("como lo resolvemos para que sea sostenible? Vercel?"):
// PROTOTIPO DESCARTABLE -- prueba si se puede hacer el mismo login que
// refresh_token.py (Cobus Group / IA40) desde una funcion serverless en
// Vercel en vez de depender de que la PC del usuario este encendida.
// Mismo flujo exacto que el script Python (mismo STEALTH_JS, mismos
// selectores) -- la unica incognita real es si Cobus bloquea/desafia las
// IPs de datacenter de Vercel, algo que no se puede saber sin probar.
// NO esta conectado a app_settings ni al cron todavia -- solo reporta
// si el login+captura de token funciona o donde se traba. Borrar este
// archivo si el resultado es negativo (Cobus bloquea) o una vez que se
// haya portado a la version real conectada al cron.
function isAuthorized(req: Request): boolean {
  const secret = process.env.TOKEN_UPDATE_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const username = process.env.IA40_USERNAME;
  const password = process.env.IA40_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ error: "Faltan IA40_USERNAME/IA40_PASSWORD en las variables de entorno." }, { status: 500 });
  }

  const pasos: string[] = [];
  // Objeto (no variable suelta) a proposito -- TS pierde el tipo real de
  // una variable reasignada dentro de un callback async y la termina
  // angostando a "never" en el uso mas abajo; con una propiedad de
  // objeto no le pasa.
  const captured: { token: string | null } = { token: null };
  let loginError: string | null = null;

  let browser;
  try {
    pasos.push("lanzando chromium");
    browser = await playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const context = await browser.newContext({ userAgent: USER_AGENT, locale: "es-AR" });
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

    pasos.push("esperando iframe de login");
    let loginFrame = null;
    for (let i = 0; i < 20; i++) {
      loginFrame = page.frames().find((f) => f.url().includes("cobus1login")) ?? null;
      if (loginFrame) break;
      await page.waitForTimeout(250);
    }
    if (!loginFrame) {
      throw new Error("No aparecio el iframe de login (cobus1login.html) tras clickear INGRESAR.");
    }

    pasos.push("completando usuario/contrasena");
    await loginFrame.fill("#login1", username);
    await loginFrame.fill("#pass", password);
    await loginFrame.click("a[onclick='funcion()']");

    pasos.push("esperando resultado del login");
    await page.waitForTimeout(4000);

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

    return NextResponse.json({
      ok: !!captured.token,
      pasos,
      finalUrl,
      tokenLength: captured.token ? captured.token.length : 0,
      loginError,
    });
  } catch (err: any) {
    if (browser) await browser.close().catch(() => {});
    return NextResponse.json(
      { ok: false, pasos, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
