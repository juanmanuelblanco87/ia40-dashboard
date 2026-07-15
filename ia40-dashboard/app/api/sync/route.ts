import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { fetchIa40Data, Ia40AuthError } from "@/lib/ia40";
import { fetchIa40ExportRows, Ia40AuthError as Ia40ExportAuthError } from "@/lib/ia40Export";
import { upsertRawRecords, recomputeMonthlyAgg } from "@/lib/aggregate";
import { categoryUsesExportFlow } from "@/lib/parsers";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // requiere plan Pro para superar 60s

interface CategoryRow {
  id: number;
  slug: string;
}
interface NcmRow {
  ncm_code: string;
}

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // sin secreto configurado, no bloquea (solo para dev local)
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function dateRangeLastNMonths(n: number): { start: string; end: string } {
  // Los datos de aduana tienen retraso de carga: el mes recien terminado
  // todavia no esta completo hasta pasados unos ~15 dias del mes siguiente.
  // Por eso el mes anterior NO se usa como fin del rango si todavia estamos
  // dentro de esa ventana de gracia; en ese caso se salta un mes mas atras.
  // Configurable por si el retraso real de Cobus resulta ser mayor o menor.
  const graceDays = Number(process.env.SYNC_DATA_LAG_DAYS ?? 15);

  const now = new Date();
  let refMonth = now.getMonth(); // mes actual (0-indexado)
  const refYear = now.getFullYear();

  if (now.getDate() <= graceDays) {
    // Todavia dentro de la ventana de gracia del mes actual -> el mes
    // anterior tampoco esta completo, se retrocede un mes mas.
    refMonth -= 1;
  }

  const end = new Date(refYear, refMonth, 0); // dia 0 = ultimo dia del mes anterior a refMonth
  const start = new Date(end.getFullYear(), end.getMonth() - (n - 1), 1);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Minimo 24 meses de historial (pedido del negocio). Se puede pisar con
  // la variable de entorno SYNC_MONTHS_BACK si hiciera falta mas o menos.
  const monthsBack = Number(process.env.SYNC_MONTHS_BACK ?? 24);
  const { start, end } = dateRangeLastNMonths(monthsBack);

  const categories = await query<CategoryRow>(`select id, slug from categories`);
  const results: any[] = [];

  for (const cat of categories) {
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
        // Las categorias con parser registrado (ver lib/parsers) necesitan
        // el flujo de EXPORTACION de IA40, que es el unico que trae la
        // columna "SUB ITEMS - SUFIJOS" (marca/modelo). Las demas siguen
        // usando /data como hasta ahora.
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

        const inserted = await upsertRawRecords(cat.id, cat.slug, ncm_code, rows);

        // DIAGNOSTICO TEMPORAL (15/07/2026): algunas categorias reportan
        // "inserted" en miles pero trade_records termina con 0-1 filas al
        // consultarlo despues desde afuera. Este count corre en la MISMA
        // conexion/request, inmediatamente despues del upsert, para saber
        // si el dato esta ahi en el momento mismo de escribirlo o si nunca
        // llego a persistir. Sacar una vez resuelto el misterio.
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
