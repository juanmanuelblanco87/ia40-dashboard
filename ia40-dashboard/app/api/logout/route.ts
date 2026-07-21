import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** POST /api/logout -- borra la cookie de sesion (ver middleware.ts). */
export async function POST() {
  const resp = NextResponse.json({ ok: true });
  resp.cookies.set("icom_auth", "", { path: "/", maxAge: 0 });
  return resp;
}
