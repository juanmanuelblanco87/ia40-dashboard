import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrSearchModelPvp } from "@/lib/modelPvp";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // requiere plan Pro para superar 60s (mismo limite que /api/sieve)

// Limites conservadores: cada item puede implicar mas de una llamada al
// tool web_search de OpenAI (a diferencia del PVP oportunista del
// tamizador de segmentos, este SI hace una busqueda dedicada, con fallback
// a productos similares -- ver lib/pvpFinder.ts), asi que cada item tarda
// un poco mas que en /api/sieve.
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 100;
const PVP_SIEVE_CONCURRENCY = Number(process.env.PVP_SIEVE_CONCURRENCY ?? 8);
const PVP_SIEVE_TIME_BUDGET_MS = Number(process.env.PVP_SIEVE_TIME_BUDGET_MS ?? 260_000);

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
}

interface PendienteRow {
  marca: string;
  modelo: string;
}

/**
 * GET /api/pvp-sieve?category=<slug>&limit=<n>
 *
 * "Completar PVP" (17/07/2026): el tamizador de segmentos (/api/sieve) solo
 * completa el PVP de forma OPORTUNISTA (aprovecha la busqueda que ya hace
 * para el segmento, sin buscar de nuevo -- ver ACTUALIZACION 2 en
 * lib/aiClassifier.ts, hecha justamente para no volver lento el tamizador).
 * Eso deja la mayoria de los modelos sin PVP despues de tamizar (ej. 10 de
 * 100). Este endpoint corre, en lote, la version EXHAUSTIVA de la busqueda
 * de precio (lib/pvpFinder.ts vía getOrSearchModelPvp(), la misma que usa
 * el boton manual "Consultar precio") sobre todos los modelos de una
 * categoria que TODAVIA no tengan un PVP 'found' guardado -- para no tener
 * que clickear "Consultar" fila por fila.
 *
 * Reusa getOrSearchModelPvp() tal cual (misma cache/reintento que el boton
 * manual: 'found' es definitivo, 'not_found'/'error' se reintentan), asi que
 * correr esto varias veces sobre la misma categoria no duplica trabajo ya
 * resuelto.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("category");
  if (!slug) {
    return NextResponse.json({ error: "Falta ?category=" }, { status: 400 });
  }

  const limitParam = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(limitParam || DEFAULT_LIMIT, MAX_LIMIT));

  const catRows = await query<CategoryRow>(`select id, slug, name from categories where slug = $1`, [slug]);
  if (catRows.length === 0) {
    return NextResponse.json({ error: `Categoria "${slug}" no encontrada` }, { status: 404 });
  }
  const categoria = catRows[0];

  // Mismo patron de priorizacion por FOB total que /api/sieve: se completan
  // primero los modelos con mas peso en el negocio.
  const pendientes = await query<PendienteRow>(
    `select t.marca, t.modelo
     from (
       select
         agg.marca, agg.modelo,
         sum(agg.total_fob_dolars) over (partition by agg.marca, agg.modelo) as total_fob,
         row_number() over (partition by agg.marca, agg.modelo order by agg.period desc) as rn
       from monthly_brand_model_agg agg
       left join model_pvp mp
         on mp.category_id = agg.category_id and mp.marca = agg.marca and mp.modelo = agg.modelo
       where agg.category_id = $1
         and (mp.id is null or mp.status <> 'found')
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
    encontrados: 0,
    sin_evidencia: 0,
    errores: 0,
    detalle_errores: [] as string[],
    // true si se corto el lote por el presupuesto de tiempo antes de llegar
    // a `solicitados` -- con otro click se sigue desde donde quedo (los
    // 'found' ya guardados no se vuelven a consultar).
    parcial: false,
  };

  async function procesarItem({ marca, modelo }: PendienteRow) {
    try {
      const pvp = await getOrSearchModelPvp(categoria.id, categoria.name, marca, modelo);
      resumen.procesados++;
      if (pvp.pvp_usd != null) resumen.encontrados++;
      else resumen.sin_evidencia++;
    } catch (err: any) {
      resumen.errores++;
      resumen.detalle_errores.push(`${marca} / ${modelo}: ${String(err?.message ?? err)}`);
    }
  }

  const startedAt = Date.now();
  for (let i = 0; i < pendientes.length; i += PVP_SIEVE_CONCURRENCY) {
    if (Date.now() - startedAt > PVP_SIEVE_TIME_BUDGET_MS) {
      resumen.parcial = true;
      break;
    }
    const tanda = pendientes.slice(i, i + PVP_SIEVE_CONCURRENCY);
    await Promise.all(tanda.map(procesarItem));
  }

  return NextResponse.json(resumen);
}
