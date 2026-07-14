import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// Mismos 6 segmentos que puede asignar el parser automatico (paso 11).
// Se valida acá para no permitir cargar un valor con typo desde el front.
const VALID_SEGMENTOS = [
  "Silla Estándar",
  "Silla Ultra Livianas",
  "Sillas Infantiles",
  "Silla Postural",
  "Silla Activa y Deportivas",
  "Silla de Traslado",
];

// POST /api/model-overrides
// body: { category, marca, modelo, segmento?, image_url?, source_url? }
// Correccion manual por combinacion marca+modelo, para los casos donde el
// parser automatico (segmento) o la busqueda automatica (imagen) se
// equivocan. Tiene prioridad sobre lo calculado automaticamente:
//  - segmento: se guarda en model_segmento_override y /api/evolution lo
//    aplica con un LEFT JOIN (coalesce(override, calculado)), asi el cambio
//    se ve al toque sin esperar al proximo /api/sync.
//  - imagen: se guarda directo en model_images con status='found',
//    pisando lo que hubiera antes (encontrado automaticamente o no).
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const { category, marca, modelo, segmento, image_url, source_url } = body ?? {};

  if (!category || !marca || !modelo) {
    return NextResponse.json({ error: "Faltan category/marca/modelo" }, { status: 400 });
  }

  const cat = await query<{ id: number }>(`select id from categories where slug = $1`, [category]);
  if (cat.length === 0) {
    return NextResponse.json({ error: "Categoria no encontrada" }, { status: 404 });
  }
  const categoryId = cat[0].id;

  if (segmento) {
    if (!VALID_SEGMENTOS.includes(segmento)) {
      return NextResponse.json({ error: "Segmento invalido" }, { status: 400 });
    }
    await query(
      `insert into model_segmento_override (category_id, marca, modelo, segmento)
       values ($1, $2, $3, $4)
       on conflict (category_id, marca, modelo)
       do update set segmento = excluded.segmento, updated_at = now()`,
      [categoryId, marca, modelo, segmento]
    );
  }

  if (image_url) {
    await query(
      `insert into model_images (category_id, marca, modelo, image_url, thumbnail_url, source_url, status, fetched_at)
       values ($1, $2, $3, $4, $4, $5, 'found', now())
       on conflict (category_id, marca, modelo)
       do update set
         image_url = excluded.image_url,
         thumbnail_url = excluded.thumbnail_url,
         source_url = excluded.source_url,
         status = 'found',
         fetched_at = now(),
         error_message = null`,
      [categoryId, marca, modelo, image_url, source_url ?? null]
    );
  }

  return NextResponse.json({ ok: true });
}
