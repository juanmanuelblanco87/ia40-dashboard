import crypto from "node:crypto";
import { query } from "./db";

export interface FieldMapping {
  target_field: "marca" | "modelo" | "proveedor" | "fecha" | "fob_dolars" | "unidades";
  source_json_path: string;
}

export async function getFieldMappings(categoryId: number): Promise<FieldMapping[]> {
  return query<FieldMapping>(
    `select target_field, source_json_path from field_mappings where category_id = $1`,
    [categoryId]
  );
}

export function mappingLookup(mappings: FieldMapping[], target: string): string | undefined {
  return mappings.find((m) => m.target_field === target)?.source_json_path;
}

/** Extrae un campo del objeto crudo devuelto por la API usando el nombre de columna mapeado. */
function extract(row: Record<string, any>, path?: string): any {
  if (!path) return null;
  return row[path] ?? null;
}

/**
 * Convierte una fecha a "primer dia del mes" (YYYY-MM-01) para agrupar por periodo.
 * La API de IA40 devuelve la fecha en formato argentino DD/MM/YYYY, que NO se puede
 * pasar directo a `new Date(...)` (JS lo interpreta como MM/DD/YYYY y da resultados
 * incorrectos, ej. "07/04/2026" -> 4 de julio en vez de 7 de abril). Por eso se
 * parsea a mano antes de intentar cualquier fallback generico.
 */
function toMonthStart(dateStr: string | null): string | null {
  if (!dateStr) return null;

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateStr);
  if (dmy) {
    const [, , mm, yyyy] = dmy;
    return `${yyyy}-${mm}-01`;
  }

  // Fallback por si algun dia llega en otro formato (ISO, etc.)
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Inserta filas crudas (idempotente via hash) para una categoria/posicion arancelaria.
 * Guarda el JSON completo en `raw` y deriva `period`/`fob_dolars` usando el mapeo de
 * campos de la categoria (o los nombres reales observados en IA40 como fallback:
 * "fecha" y "fob_dolars_item").
 */
export async function upsertRawRecords(categoryId: number, ncmCode: string, rows: any[]): Promise<number> {
  if (rows.length === 0) return 0;
  const mappings = await getFieldMappings(categoryId);
  const fechaPath = mappingLookup(mappings, "fecha") ?? "fecha";
  const fobPath = mappingLookup(mappings, "fob_dolars") ?? "fob_dolars_item";

  let inserted = 0;
  for (const row of rows) {
    const hash = crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
    const period = toMonthStart(extract(row, fechaPath)) ?? new Date().toISOString().slice(0, 7) + "-01";
    const fob = Number(extract(row, fobPath)) || null;
    const cuit = row.cuit ?? null;

    const result = await query(
      `insert into trade_records (category_id, ncm_code, period, cuit, raw, fob_dolars, source_hash)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (source_hash) do nothing
       returning id`,
      [categoryId, ncmCode, period, cuit, JSON.stringify(row), fob, hash]
    );
    inserted += result.length ? 1 : 0;
  }
  return inserted;
}

/**
 * Recalcula el agregado mensual por marca/modelo/proveedor para una categoria.
 *
 * "proveedor" = la empresa importadora (campo "nombre" en el JSON crudo de IA40).
 * "marca" no viene directo en los datos para esta categoria -> se identifica
 * manualmente por importador, cargando el mapeo en `provider_brand_map` (ver
 * /api/providers y la pantalla /admin). Mientras un importador no fue
 * clasificado todavia, aparece como "sin_identificar".
 *
 * Si en el futuro alguna categoria SI trae marca/modelo directo en el JSON
 * (field_mappings con target_field 'marca'/'modelo'), esa fuente tiene
 * prioridad sobre el mapeo manual por importador.
 */
export async function recomputeMonthlyAgg(categoryId: number): Promise<void> {
  const mappings = await getFieldMappings(categoryId);
  const marcaPath = mappingLookup(mappings, "marca") ?? "__none__";
  const modeloPath = mappingLookup(mappings, "modelo") ?? "__none__";
  const proveedorPath = mappingLookup(mappings, "proveedor") ?? "nombre";

  await query(`delete from monthly_brand_model_agg where category_id = $1`, [categoryId]);

  await query(
    `insert into monthly_brand_model_agg
       (category_id, period, marca, modelo, proveedor, total_fob_dolars, record_count)
     select
       tr.category_id,
       tr.period,
       case
         when $2::text = '__none__' then coalesce(pbm.marca, 'sin_identificar')
         else tr.raw ->> $2::text
       end as marca,
       case
         when $3::text = '__none__' then pbm.modelo
         else tr.raw ->> $3::text
       end as modelo,
       coalesce(tr.raw ->> $4::text, 'sin_dato') as proveedor,
       sum(coalesce(tr.fob_dolars, 0)) as total_fob_dolars,
       count(*) as record_count
     from trade_records tr
     left join provider_brand_map pbm
       on pbm.category_id = tr.category_id
      and pbm.importer_name = tr.raw ->> $4::text
     where tr.category_id = $1
     -- Se agrupa por posicion (1..5) y no por nombre de columna: "marca" y
     -- "modelo" son tambien nombres de columnas reales en provider_brand_map,
     -- y Postgres prioriza esa columna sobre el alias del SELECT, lo que
     -- rompia el group by con "column tr.raw must appear in..."
     group by 1, 2, 3, 4, 5`,
    [categoryId, marcaPath, modeloPath, proveedorPath]
  );
}
