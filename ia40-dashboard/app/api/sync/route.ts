import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { fetchIa40Data, Ia40AuthError } from "@/lib/ia40";
import { upsertRawRecords, recomputeMonthlyAgg } from "@/lib/aggregate";

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
  // Los datos de aduana tienen un retraso de procesamiento: el mes en curso
  // todavia no esta completo. En vez de adivinar un colchon de dias, pedimos
  // siempre hasta el ULTIMO DIA DEL MES ANTERIOR (nunca el mes actual), y el
  // inicio es el primer dia del mes n-1 meses antes de ese fin -> asi el
  // rango cubre exactamente n meses calendario completos.
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 0); // dia 0 = ultimo dia del mes anterior
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

    for (const { ncm_code } of ncmCodes) {
      try {
        const { rows } = await fetchIa40Data({
          countryCodi: "ARG",
          informationTypeCodi: "ARGACT",
          operationTypeCodi: "ARGACTIMP",
          dateStart: start,
          dateEnd: end,
          filters: [{ field: "posicion_arancelaria", values: [ncm_code] }],
        });

        const inserted = await upsertRawRecords(cat.id, ncm_code, rows);

        await query(
          `insert into sync_runs (category_id, ncm_code, period_start, period_end, rows_ingested, status)
           values ($1, $2, $3, $4, $5, 'ok')`,
          [cat.id, ncm_code, start, end, inserted]
        );

        results.push({ category: cat.slug, ncm_code, fetched: rows.length, inserted });
      } catch (err: any) {
        const status = err instanceof Ia40AuthError ? "auth_error" : "error";
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
