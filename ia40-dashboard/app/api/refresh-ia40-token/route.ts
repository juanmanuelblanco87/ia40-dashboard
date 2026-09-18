import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { fetchFreshIa40Token, Ia40LoginError } from "@/lib/ia40Login";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 18/09/2026 ("como lo resolvemos para que sea sostenible? Vercel?"):
// reemplaza a refresh_token.py + CobusSync_Installer (Windows Task
// Scheduler en la PC del usuario, cada 10 min) -- mismo login real,
// pero corriendo en Vercel via un Cron Job (ver vercel.json), sin
// depender de que una PC fisica este encendida. Confirmado en vivo
// (18/09/2026) que Cobus no bloquea las IPs de datacenter de Vercel.
// Guarda el token directo en app_settings (mismo INSERT que ya hacia
// POST /api/token) -- no hace falta la vuelta por HTTP, ya estamos del
// lado del servidor.
//
// Mismo criterio de auth que /api/sync (CRON_SECRET, header o
// ?secret= para poder probar a mano) -- este endpoint SI lo llama un
// Cron Job de Vercel, a diferencia de /api/test-ia40-login (manual,
// con TOKEN_UPDATE_SECRET).
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // sin secreto configurado, no bloquea (solo dev local)
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  const { searchParams } = new URL(req.url);
  return searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const username = process.env.IA40_USERNAME;
  const password = process.env.IA40_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ error: "Faltan IA40_USERNAME/IA40_PASSWORD en las variables de entorno." }, { status: 500 });
  }

  try {
    const { token, pasos } = await fetchFreshIa40Token(username, password);

    await query(
      `insert into app_settings (key, value, updated_at) values ('ia40_jwt', $1, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [token]
    );

    return NextResponse.json({ ok: true, updatedAt: new Date().toISOString(), tokenLength: token.length, pasos });
  } catch (err) {
    const status = err instanceof Ia40LoginError ? 502 : 500;
    return NextResponse.json({ ok: false, error: String((err as any)?.message ?? err) }, { status });
  }
}
