import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/calc/meli-oauth/status
 *
 * Estado de la conexion OAuth con Mercado Libre (20/07/2026) -- si hay
 * refresh_token guardado, se considera "conectada" (el access_token se
 * refresca solo cuando hace falta, ver lib/meliApi.ts getAccessToken()).
 */
export async function GET() {
  const rows = await query<any>(`select refresh_token, expires_at, updated_at from meli_oauth where id=1`);
  const row = rows[0];
  return NextResponse.json({
    conectado: !!row?.refresh_token,
    expiresAt: row?.expires_at ?? null,
    updatedAt: row?.updated_at ?? null,
  });
}
