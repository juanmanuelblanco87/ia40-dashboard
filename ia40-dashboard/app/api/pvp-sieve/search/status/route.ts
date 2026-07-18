import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface CategoryRow {
  id: number;
}

/**
 * GET /api/pvp-sieve/status?category=<slug>
 * Devuelve cuantas combinaciones marca+modelo tiene la categoria en total y
 * cuantas ya tienen un PVP 'found' guardado en model_pvp -- para mostrar un
 * % de avance en el boton "Completar PVP" sin correr un lote real (consulta
 * liviana, no gasta OpenAI). Mismo patron que /api/sieve/status.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("category");
  if (!slug) {
    return NextResponse.json({ error: "Falta ?category=" }, { status: 400 });
  }

  const cat = await query<CategoryRow>(`select id from categories where slug = $1`, [slug]);
  if (cat.length === 0) {
    return NextResponse.json({ error: "Categoria no encontrada" }, { status: 404 });
  }
  const categoryId = cat[0].id;

  const totalRows = await query<{ total: string }>(
    `select count(*) as total from (
       select distinct marca, modelo from monthly_brand_model_agg
       where category_id = $1 and marca is not null and marca <> '' and modelo is not null and modelo <> ''
     ) t`,
    [categoryId]
  );
  const encontradosRows = await query<{ total: string }>(
    `select count(*) as total from model_pvp where category_id = $1 and status = 'found'`,
    [categoryId]
  );

  const total = Number(totalRows[0]?.total ?? 0);
  const encontrados = Number(encontradosRows[0]?.total ?? 0);
  const pendientes = Math.max(0, total - encontrados);
  const porcentaje = total > 0 ? Math.round((encontrados / total) * 100) : 100;

  return NextResponse.json({ total, encontrados, pendientes, porcentaje });
}
