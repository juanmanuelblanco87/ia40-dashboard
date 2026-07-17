import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { recomputeMonthlyAgg } from "@/lib/aggregate";
import { classifyProduct, AiClassifierError, type CategoriaOpcion } from "@/lib/aiClassifier";
import { segmentosValidos } from "@/lib/segmentos";
import { ORTOPEDIA_9021_CATEGORY_SLUGS } from "@/lib/parsers";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // requiere plan Pro para superar 60s

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// Pequeña pausa entre items -- con OpenAI en un proyecto con facturacion
// activa (tier pago) el limite de requests-por-minuto es mucho mas alto que
// en el plan gratis de Gemini (usado antes), pero se deja un margen chico
// igual para no disparar todo en paralelo de golpe.
const SIEVE_DELAY_MS = Number(process.env.SIEVE_DELAY_MS ?? 500);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
}

interface PendienteRow {
  marca: string;
  modelo: string;
  segmento_actual: string | null;
}

/**
 * GET /api/sieve?category=<slug>&limit=<n>
 *
 * "Tamizador de segmentos" (17/07/2026): para cada combinacion marca+modelo
 * de la categoria elegida que TODAVIA no se valido (ver model_sieve_log),
 * le pide a OpenAI (lib/aiClassifier.ts, Responses API + tool "web_search")
 * que busque el producto en la web POR SU CUENTA y decida el segmento real
 * -- y, si la categoria es una de las 3 de NCM compartido (andadores /
 * bastones / calzado_ortopedico), tambien si el producto esta en la
 * categoria correcta (un mismo fabricante puede vender, bajo codigos
 * parecidos, productos que en realidad son de otra de las 3 categorias --
 * ver docs/PROYECTO.md, caso real: "Double Care Medical HY7300L"
 * clasificado como andador siendo en realidad un baston).
 *
 * SerpApi NO se usa aca: esa cuota (250 busquedas/mes gratis) queda
 * reservada solo para pegar la imagen de un producto al catalogo
 * (lib/imageSearch.ts), un flujo completamente aparte. Tampoco se usa
 * Gemini (se probo antes, pero requeria facturacion activada en Google
 * para que el tool de busqueda funcionara -- ver historial en
 * docs/PROYECTO.md seccion 10.1). La empresa decidio pagar OpenAI en su
 * lugar (proyecto "cobus" en platform.openai.com).
 *
 * Corre en LOTES (parametro `limit`, default 20) porque cada fila gasta una
 * llamada a OpenAI (con costo: ~USD 0.01 por busqueda web + tokens del
 * modelo, ver lib/aiClassifier.ts).
 * Se dispara manualmente desde el boton "Tamizar categoria" del dashboard,
 * NO esta en ningun cron.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("category");
  if (!slug) {
    return NextResponse.json({ error: "Falta ?category=" }, { status: 400 });
  }

  const limitParam = Number(searchParams.get("limit") ?? process.env.SIEVE_BATCH_LIMIT ?? DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(limitParam || DEFAULT_LIMIT, MAX_LIMIT));

  const catRows = await query<CategoryRow>(`select id, slug, name from categories where slug = $1`, [slug]);
  if (catRows.length === 0) {
    return NextResponse.json({ error: `Categoria "${slug}" no encontrada` }, { status: 404 });
  }
  const categoria = catRows[0];

  const esCompartida = (ORTOPEDIA_9021_CATEGORY_SLUGS as readonly string[]).includes(slug);
  let opcionesCategoria: (CategoryRow & { segmentos: string[] })[] | undefined;
  if (esCompartida) {
    const rows = await query<CategoryRow>(`select id, slug, name from categories where slug = any($1::text[])`, [
      ORTOPEDIA_9021_CATEGORY_SLUGS as unknown as string[],
    ]);
    opcionesCategoria = rows.map((r) => ({ ...r, segmentos: segmentosValidos(r.slug) }));
  }

  const segmentosActuales = segmentosValidos(slug);

  // Se prioriza por FOB total acumulado (todos los meses) de mayor a menor,
  // para que el tamizador revise primero los modelos con mas peso en el
  // negocio en vez de ir alfabetico -- pedido explicito del usuario
  // (17/07/2026): "el tamizador debe comenzar desde modelos con mayor peso
  // en FOB a menor peso en FOB".
  const pendientes = await query<PendienteRow>(
    `select t.marca, t.modelo, t.segmento_actual
     from (
       select
         agg.marca, agg.modelo,
         coalesce(mso.segmento, agg.segmento) as segmento_actual,
         sum(agg.total_fob_dolars) over (partition by agg.marca, agg.modelo) as total_fob,
         row_number() over (partition by agg.marca, agg.modelo order by agg.period desc) as rn
       from monthly_brand_model_agg agg
       left join model_segmento_override mso
         on mso.category_id = agg.category_id and mso.marca = agg.marca and mso.modelo = agg.modelo
       left join model_sieve_log log
         on log.category_id = agg.category_id and log.marca = agg.marca and log.modelo = agg.modelo
       where agg.category_id = $1
         and log.id is null
         and agg.marca is not null and agg.marca <> ''
         and agg.modelo is not null and agg.modelo <> ''
     ) t
     where t.rn = 1
     order by t.total_fob desc
     limit $2`,
    [categoria.id, limit]
  );

  const resumen = {
    categoria: slug,
    solicitados: pendientes.length,
    procesados: 0,
    sin_cambios: 0,
    segmento_corregido: 0,
    categoria_movida: 0,
    sin_evidencia: 0,
    errores: 0,
    movidos: [] as { marca: string; modelo: string; de: string; a: string; segmento: string | null; razonamiento: string }[],
    corregidos: [] as { marca: string; modelo: string; segmento: string; razonamiento: string }[],
    detalle_errores: [] as string[],
  };

  const categoriasTocadas = new Set<number>([categoria.id]);

  async function logSieve(categoryId: number, marca: string, modelo: string, result: string, detail: string) {
    await query(
      `insert into model_sieve_log (category_id, marca, modelo, result, detail)
       values ($1, $2, $3, $4, $5)
       on conflict (category_id, marca, modelo)
       do update set checked_at = now(), result = excluded.result, detail = excluded.detail`,
      [categoryId, marca, modelo, result, detail]
    );
  }

  for (const [idx, { marca, modelo, segmento_actual }] of pendientes.entries()) {
    if (idx > 0) await sleep(SIEVE_DELAY_MS);
    try {
      const clasif = await classifyProduct({
        marca,
        modelo,
        categoriaActualSlug: slug,
        categoriaActualNombre: categoria.name,
        segmentosValidos: segmentosActuales,
        opcionesCategoria: opcionesCategoria?.map(
          (o): CategoriaOpcion => ({ slug: o.slug, nombre: o.name, segmentos: o.segmentos })
        ),
      });

      resumen.procesados++;

      const confiable = clasif.confianza === "alta" || clasif.confianza === "media";
      const destino =
        confiable && clasif.categoriaSlug && clasif.categoriaSlug !== slug
          ? opcionesCategoria?.find((o) => o.slug === clasif.categoriaSlug)
          : undefined;

      if (destino) {
        // Re-clasificar: mover la fila de categoria (mismo NCM compartido).
        const segmentoDestino = clasif.segmento ?? destino.segmentos[0] ?? null;
        await query(
          `update trade_records set category_id = $1, segmento = $2
           where category_id = $3 and marca = $4 and modelo = $5`,
          [destino.id, segmentoDestino, categoria.id, marca, modelo]
        );
        // Mover cache de imagen y override de segmento si existian, para que
        // no queden huerfanos apuntando a la categoria vieja (best-effort:
        // si ya hay una fila para esa combinacion en la categoria destino,
        // se deja como esta en vez de fallar por el unique constraint).
        await query(
          `update model_images set category_id = $1
           where category_id = $2 and marca = $3 and modelo = $4
             and not exists (
               select 1 from model_images x where x.category_id = $1 and x.marca = $3 and x.modelo = $4
             )`,
          [destino.id, categoria.id, marca, modelo]
        );
        await query(
          `update model_segmento_override set category_id = $1
           where category_id = $2 and marca = $3 and modelo = $4
             and not exists (
               select 1 from model_segmento_override x where x.category_id = $1 and x.marca = $3 and x.modelo = $4
             )`,
          [destino.id, categoria.id, marca, modelo]
        );

        categoriasTocadas.add(destino.id);
        resumen.categoria_movida++;
        resumen.movidos.push({
          marca,
          modelo,
          de: categoria.name,
          a: destino.name,
          segmento: segmentoDestino,
          razonamiento: clasif.razonamiento,
        });

        await logSieve(categoria.id, marca, modelo, `movido_a_${destino.slug}`, clasif.razonamiento);
        // Registrar tambien contra la categoria destino, para que un futuro
        // tamizado de ESA categoria no vuelva a procesar esta combinacion.
        await logSieve(destino.id, marca, modelo, `movido_desde_${slug}`, clasif.razonamiento);
      } else if (confiable && clasif.segmento && clasif.segmento !== segmento_actual) {
        // Mismo lugar, pero el segmento calculado por el parser estaba mal
        // (o incompleto, ej. "(revisar)") -- se corrige via override, sin
        // esperar a que alguien lo haga a mano.
        await query(
          `insert into model_segmento_override (category_id, marca, modelo, segmento)
           values ($1, $2, $3, $4)
           on conflict (category_id, marca, modelo)
           do update set segmento = excluded.segmento, updated_at = now()`,
          [categoria.id, marca, modelo, clasif.segmento]
        );
        resumen.segmento_corregido++;
        resumen.corregidos.push({ marca, modelo, segmento: clasif.segmento, razonamiento: clasif.razonamiento });
        await logSieve(categoria.id, marca, modelo, "segmento_corregido", clasif.razonamiento);
      } else if (!confiable) {
        resumen.sin_evidencia++;
        await logSieve(categoria.id, marca, modelo, "sin_evidencia", clasif.razonamiento);
      } else {
        resumen.sin_cambios++;
        await logSieve(categoria.id, marca, modelo, "sin_cambios", clasif.razonamiento);
      }
    } catch (err: any) {
      // Cualquier error (falta de API key, 429, respuesta no parseable,
      // etc.) se registra y se sigue con el resto del lote -- no se corta
      // todo por una fila puntual.
      resumen.errores++;
      resumen.detalle_errores.push(`${marca} / ${modelo}: ${String(err?.message ?? err)}`);
      continue;
    }
  }

  for (const catId of categoriasTocadas) {
    await recomputeMonthlyAgg(catId);
  }

  return NextResponse.json(resumen);
}
