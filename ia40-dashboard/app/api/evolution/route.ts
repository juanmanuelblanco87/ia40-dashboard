import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/evolution?category=sillas_de_ruedas&marca=X&modelo=Y
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("category");
  const marca = searchParams.get("marca");
  const modelo = searchParams.get("modelo");

  if (!slug) {
    return NextResponse.json({ error: "Falta ?category=" }, { status: 400 });
  }

  const cat = await query<{ id: number }>(`select id from categories where slug = $1`, [slug]);
  if (cat.length === 0) {
    return NextResponse.json({ error: "Categoria no encontrada" }, { status: 404 });
  }
  const categoryId = cat[0].id;

  const conditions = ["category_id = $1"];
  const params: any[] = [categoryId];
  if (marca) {
    params.push(marca);
    conditions.push(`marca = $${params.length}`);
  }
  if (modelo) {
    params.push(modelo);
    conditions.push(`modelo = $${params.length}`);
  }

  const rows = await query(
    `select period, marca, modelo, proveedor, total_fob_dolars, total_unidades, record_count
     from monthly_brand_model_agg
     where ${conditions.join(" and ")}
     order by period asc`,
    params
  );

  // Tambien devolvemos las marcas/modelos disponibles para poblar los selectores del front.
  const options = await query(
    `select distinct marca, modelo from monthly_brand_model_agg where category_id = $1 order by 1, 2`,
    [categoryId]
  );

  return NextResponse.json({ series: rows, options });
}
