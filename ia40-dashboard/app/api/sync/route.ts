import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { fetchIa40Data, Ia40AuthError } from "@/lib/ia40";
import { fetchIa40ExportRows, Ia40AuthError as Ia40ExportAuthError } from "@/lib/ia40Export";
import { upsertRawRecords, upsertPreParsedRecords, recomputeMonthlyAgg } from "@/lib/aggregate";
import { categoryUsesExportFlow, parseOrtopedia9021Row, ORTOPEDIA_9021_NCM, ORTOPEDIA_9021_CATEGORY_SLUGS } from "@/lib/parsers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface CategoryRow {
  id: number;
  slug: string;
}
interface NcmRow {
  ncm_code: string;
}

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  const { searchParams } = new URL(req.url);
  return searchParams.get("secret") === secret;
}

function dateRangeLastNMonths(n: number): { start: string; end: string } {
  const graceDays = Number(process.env.SYNC_DATA_LAG_DAYS ?? 15);

  const now = new Date();
  let refMonth = now.getMonth();
  const refYear = now.getFullYear();

  if (now.getDate() <= graceDays) {
    refMonth -= 1;
  }

  const end = new Date(refYear, refMonth, 0);
  const start = new Date(end.getFullYear(), end.getMonth() - (n - 1), 1);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const monthsBack = Number(process.env.SYNC_MONTHS_BACK ?? 24);
  const { start, end } = dateRangeLastNMonths(monthsBack);

  const { searchParams } = new URL(req.url);
  const onlySlug = searchParams.get("category");

  const categories = onlySlug
    ? await query<CategoryRow>(`select id, slug from categories where slug = $1`, [onlySlug])
    : await query<CategoryRow>(`select id, slug from categories`);

  if (onlySlug && categories.length === 0) {
    return NextResponse.json({ error: `Categoria "${onlySlug}" no encontrada` }, { status: 404 });
  }

  const results: any[] = [];

  // ---------------------------------------------------------------------
  // Bloque especial: NCM 9021.10.10 compartido entre "andadores", "bastones"
  // y "calzado_ortopedico" (ver lib/parsers/index.ts, parseOrtopedia9021Row).
  // Un solo NCM se reparte en estas 3 categorias segun marca/descripcion de
  // cada fila, asi que se pide el export UNA sola vez (no una vez por
  // categoria, que descargaria ~19000 filas 3 veces) y se distribuye.
  // ---------------------------------------------------------------------
  const sharedOrtopediaCats = categories.filter((c) =>
    (ORTOPEDIA_9021_CATEGORY_SLUGS as readonly string[]).includes(c.slug)
  );

  if (sharedOrtopediaCats.length > 0) {
    try {
      const rows = await fetchIa40ExportRows({
        countryCodi: "ARG",
        informationTypeCodi: "ARGACT",
        operationTypeCodi: "ARGACTIMP",
        dateStart: start,
        dateEnd: end,
        ncmCode: ORTOPEDIA_9021_NCM,
      });

      const buckets: Record<string, { row: any; marca: string; modelo: string; color: string; segmento: string }[]> = {
        andadores: [],
        bastones: [],
        calzado_ortopedico: [],
      };
      let descartadas = 0;
      for (const row of rows) {
        const parsed = parseOrtopedia9021Row(row);
        if (!parsed.categoriaSlug) {
          descartadas++;
          continue;
        }
        buckets[parsed.categoriaSlug].push({
          row,
          marca: parsed.marca,
          modelo: parsed.modelo,
          color: parsed.color,
          segmento: parsed.segmento,
        });
      }

      for (const cat of sharedOrtopediaCats) {
        const items = buckets[cat.slug] ?? [];
        const { inserted, uniqueHashesInBatch, sampleHashes, sampleRow } = await upsertPreParsedRecords(
          cat.id,
          ORTOPEDIA_9021_NCM,
          items
        );

        const verify = await query<{ total: string; distinct_hash: string }>(
          `select count(*) as total, count(distinct source_hash) as distinct_hash
           from trade_records where category_id = $1`,
          [cat.id]
        );

        await query(
          `insert into sync_runs (category_id, ncm_code, period_start, period_end, rows_ingested, status)
           values ($1, $2, $3, $4, $5, 'ok')`,
          [cat.id, ORTOPEDIA_9021_NCM, start, end, inserted]
        );

        results.push({
          category: cat.slug,
          ncm_code: ORTOPEDIA_9021_NCM,
          fetched_total_ncm: rows.length,
          fetched_para_esta_categoria: items.length,
          descartadas_otras_categorias: descartadas,
          inserted,
          unique_hashes_in_batch: uniqueHashesInBatch,
          sample_hashes: sampleHashes,
          sample_row: sampleRow,
          trade_records_total_now: Number(verify[0]?.total ?? 0),
          trade_records_distinct_hash_now: Number(verify[0]?.distinct_hash ?? 0),
        });

        await recomputeMonthlyAgg(cat.id);
      }
    } catch (err: any) {
      const status = err instanceof Ia40AuthError || err instanceof Ia40ExportAuthError ? "auth_error" : "error";
      for (const cat of sharedOrtopediaCats) {
        await query(
          `insert into sync_runs (category_id, ncm_code, period_start, period_end, rows_ingested, status, error_message)
           values ($1, $2, $3, $4, 0, $5, $6)`,
          [cat.id, ORTOPEDIA_9021_NCM, start, end, status, String(err?.message ?? err)]
        );
        results.push({ category: cat.slug, ncm_code: ORTOPEDIA_9021_NCM, error: String(err?.message ?? err) });
      }
    }
  }

  const normalCats = categories.filter((c) => !(ORTOPEDIA_9021_CATEGORY_SLUGS as readonly string[]).includes(c.slug));

  for (const cat of normalCats) {
    const ncmCodes = await query<NcmRow>(
      `select ncm_code from category_ncm_codes where category_id = $1`,
      [cat.id]
    );

    if (ncmCodes.length === 0) {
      results.push({ category: cat.slug, status: "sin_ncm_configurado" });
      continue;
    }

    const useExportFlow = categoryUsesExportFlow(cat.slug);

    for (const { ncm_code } of ncmCodes) {
      try {
        const rows = useExportFlow
          ? await fetchIa40ExportRows({
              countryCodi: "ARG",
              informationTypeCodi: "ARGACT",
              operationTypeCodi: "ARGACTIMP",
              dateStart: start,
              dateEnd: end,
              ncmCode: ncm_code,
            })
          : (
              await fetchIa40Data({
                countryCodi: "ARG",
                informationTypeCodi: "ARGACT",
                operationTypeCodi: "ARGACTIMP",
                dateStart: start,
                dateEnd: end,
                filters: [{ field: "posicion_arancelaria", values: [ncm_code] }],
              })
            ).rows;

        const { inserted, uniqueHashesInBatch, sampleHashes, sampleRow } = await upsertRawRecords(cat.id, cat.slug, ncm_code, rows);

        const verify = await query<{ total: string; distinct_hash: string }>(
          `select count(*) as total, count(distinct source_hash) as distinct_hash
           from trade_records where category_id = $1`,
          [cat.id]
        );

        await query(
          `insert into sync_runs (category_id, ncm_code, period_start, period_end, rows_ingested, status)
           values ($1, $2, $3, $4, $5, 'ok')`,
          [cat.id, ncm_code, start, end, inserted]
        );

        results.push({
          category: cat.slug,
          ncm_code,
          fetched: rows.length,
          inserted,
          unique_hashes_in_batch: uniqueHashesInBatch,
          sample_hashes: sampleHashes,
          sample_row: sampleRow,
          trade_records_total_now: Number(verify[0]?.total ?? 0),
          trade_records_distinct_hash_now: Number(verify[0]?.distinct_hash ?? 0),
        });
      } catch (err: any) {
        const status =
          err instanceof Ia40AuthError || err instanceof Ia40ExportAuthError ? "auth_error" : "error";
        await query(
          `insert into sync_runs (category_id, ncm_code, period_start, period_end, rows_ingested, status, error_message)
           values ($1, $2, $3, $4, 0, $5, $6)`,
          [cat.id, ncm_code, start, end, status, String(err?.message ?? err)]
        );
        results.push({ category: cat.slug, ncm_code, error: String(err?.message ?? err) });
      }
    }

    await recomputeMonthlyAgg(cat.id);
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
