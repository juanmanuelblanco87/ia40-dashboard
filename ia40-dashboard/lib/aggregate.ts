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

function mappingLookup(mappings: FieldMapping[], target: string): string | undefined {
  return mappings.find((m) => m.target_field === target)?.source_json_path;
}

function extract(row: Record<string, any>, path?: string): any {
  if (!path) return null;
  return row[path] ?? null;
}

function toMonthStart(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function upsertRawRecords(categoryId: number, ncmCode: string, rows: any[]): Promise<number> {
  if (rows.length === 0) return 0;
  const mappings = await getFieldMappings(categoryId);
  const fechaPath = mappingLookup(mappings, "fecha");
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
       on conflict (source_hash) do nothing`,
      [categoryId, ncmCode, period, cuit, JSON.stringify(row), fob, hash]
    );
    inserted += result.length ? 1 : 0;
  }
  return inserted;
}

/**
 * Recalcula el agregado mensual por marca/modelo/proveedor para una categoria.
 * Usa '__none__' como centinela cuando marca/modelo todavia no estan mapeados,
 * y siempre referencia los 4 parametros en el texto de la consulta (con cast
 * explicito ::text) para que Postgres pueda inferir el tipo de cada uno,
 * incluso cuando la rama logica termina devolviendo null.
 */
export async function recomputeMonthlyAgg(categoryId: number): Promise<void> {
  const mappings = await getFieldMappings(categoryId);
  const marcaPath = mappingLookup(mappings, "marca") ?? "__none__";
  const modeloPath = mappingLookup(mappings, "modelo") ?? "__none__";
  const proveedorPath = mappingLookup(mappings, "proveedor") ?? "razon_social";

  await query(`delete from monthly_brand_model_agg where category_id = $1`, [categoryId]);

  await query(
    `insert into monthly_brand_model_agg
       (category_id, period, marca, modelo, proveedor, total_fob_dolars, record_count)
     select
       category_id,
       period,
       case when $2::text = '__none__' then null else raw ->> $2::text end as marca,
       case when $3::text = '__none__' then null else raw ->> $3::text end as modelo,
       coalesce(raw ->> $4::text, 'sin_dato') as proveedor,
       sum(coalesce(fob_dolars, 0)) as total_fob_dolars,
       count(*) as record_count
     from trade_records
     where category_id = $1
     group by category_id, period, marca, modelo, proveedor`,
    [categoryId, marcaPath, modeloPath, proveedorPath]
  );
}
