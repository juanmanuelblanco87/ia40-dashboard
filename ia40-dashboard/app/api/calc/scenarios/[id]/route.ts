import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** DELETE /api/calc/scenarios/:id -- borra un escenario guardado puntual. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  await query(`delete from calc_scenarios where id=$1`, [id]);
  return NextResponse.json({ ok: true });
}
