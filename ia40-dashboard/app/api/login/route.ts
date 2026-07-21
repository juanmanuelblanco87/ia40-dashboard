import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/login  { usuario, contrasena }
 *
 * Valida contra AUTH_USERS (JSON en Vercel, ej. {"icom":"2026"}) -- mismo
 * criterio que `icom_panel_unificado.html` (usuario/contraseña compartidos
 * entre el equipo), pero la validacion corre aca en el servidor, no en el
 * navegador. Si coincide, guarda una cookie httpOnly con el valor de
 * AUTH_SESSION_TOKEN -- ver middleware.ts para el detalle completo.
 */
export async function POST(req: Request) {
  const sessionToken = process.env.AUTH_SESSION_TOKEN;
  if (!sessionToken) {
    return NextResponse.json(
      { error: "Falta configurar AUTH_SESSION_TOKEN en las variables de entorno de Vercel." },
      { status: 500 }
    );
  }

  let usersRaw = process.env.AUTH_USERS;
  let users: Record<string, string> = {};
  try {
    users = usersRaw ? JSON.parse(usersRaw) : {};
  } catch {
    return NextResponse.json(
      { error: "AUTH_USERS en Vercel no es un JSON válido (ej. {\"icom\":\"2026\"})." },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const usuario = String(body?.usuario ?? "").trim();
  const contrasena = String(body?.contrasena ?? "");

  if (!usuario || !users[usuario] || users[usuario] !== contrasena) {
    return NextResponse.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }

  const resp = NextResponse.json({ ok: true });
  resp.cookies.set("icom_auth", sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });
  return resp;
}
