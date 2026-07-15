import crypto from "node:crypto";
import { query } from "./db";
import { CATEGORY_PARSERS } from "./parsers";

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
 *
 * Si la categoria tiene un parser registrado (ver lib/parsers/index.ts), se
 * calcula marca/modelo automaticamente en cada fila y se guarda directo en
 * las columnas `marca`/`modelo` de trade_records (ver recomputeMonthlyAgg).
 *
 * En conflicto de hash (fila ya existente) se actualiza marca/modelo -> asi,
 * si se agrega o mejora un parser mas adelante, con solo re-correr el sync
 * se reclasifican las filas ya guardadas sin duplicarlas.
 */
export interface UpsertResult {
  inserted: number;
  /** DIAGNOSTICO TEMPORAL (15/07/2026): cuantos hashes UNICOS hay entre las
   * filas recibidas, calculado en memoria ANTES de tocar la base. Si esto
   * es mucho menor a rows.length, IA40 esta mandando filas duplicadas (o
   * casi identicas) y el ON CONFLICT(source_hash) las esta colapsando todas
   * en unas pocas filas reales -- explicaria por que "inserted" reporta
   * miles pero trade_records termina con pocas filas. Sacar una vez
   * resuelto el misterio. */
  uniqueHashesInBatch: number;
}

export async function upsertRawRecords(categoryId: number, categorySlug: string, ncmCode: string, rows: any[]): Promise<UpsertResult> {
  if (rows.length === 0) return { inserted: 0, uniqueHashesInBatch: 0 };
  const mappings = await getFieldMappings(categoryId);
  const fechaPath = mappingLookup(mappings, "fecha") ?? "fecha";
  const fobPath = mappingLookup(mappings, "fob_dolars") ?? "fob_dolars_item";
  const parser = CATEGORY_PARSERS[categorySlug];

  const hashSet = new Set(rows.map((row) => crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex")));

  let inserted = 0;
  for (const row of rows) {
    const hash = crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
    const period = toMonthStart(extract(row, fechaPath)) ?? new Date().toISOString().slice(0, 7) + "-01";
    const fob = Number(extract(row, fobPath)) || null;
    const cuit = row.cuit ?? null;

    let marca: string | null = null;
    let modelo: string | null = null;
    let color: string | null = null;
    let segmento: string | null = null;
    if (parser) {
      const parsed = parser(row);
      if (parsed) {
        marca = parsed.marca;
        modelo = parsed.modelo;
        color = parsed.color ?? null;
        segmento = parsed.segmento ?? null;
      }
    }

    const result = await query(
      `insert into trade_records (category_id, ncm_code, period, cuit, raw, fob_dolars, marca, modelo, color, segmento, source_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (source_hash) do update set marca = excluded.marca, modelo = excluded.modelo, color = excluded.color, segmento = excluded.segmento
       returning id`,
      [categoryId, ncmCode, period, cuit, JSON.stringify(row), fob, marca, modelo, color, segmento, hash]
    );
    inserted += result.length ? 1 : 0;
  }
  return { inserted, uniqueHashesInBatch: hashSet.size };
}

/**
 * Recalcula el agregado mensual por marca/modelo/proveedor para una categoria.
 *
 * "proveedor" = la empresa importadora (campo "nombre" en el JSON crudo de IA40).
 * "marca"/"modelo"/"color" se resuelven en este orden de prioridad:
 *
 *   1. `record_brand_map`: correccion manual por LINEA de detalle individual
 *      (un importador puede tener varias marcas, y una marca varios
 *      modelos - se ve en la pantalla /admin, seccion "Lineas de detalle").
 *   2. `provider_brand_map`: correccion manual rapida por importador completo.
 *   3. `trade_records.marca`/`modelo`/`color`: lo que calculo automaticamente
 *      el parser de la categoria (ver lib/parsers) a partir del texto de
 *      aduana, si la categoria tiene uno registrado.
 *   4. "sin_identificar" (marca) / "sin_dato" (color) si nada de lo anterior aplico.
 *
 * Esto es lo que permite que, cuando aparece una marca o un color nuevo que
 * el parser no reconoce (por ejemplo al sincronizar un mes nuevo), se pueda
 * corregir desde /admin sin tocar codigo ni redesplegar: el fix queda en la
 * base y se re-aplica solo en cada sync futuro.
 *
 * Si el JSON trae marca/modelo directo (field_mappings con target_field
 * 'marca'/'modelo'), esa fuente tiene prioridad sobre todo lo demas.
 */
export async function recomputeMonthlyAgg(categoryId: number): Promise<void> {
  const mappings = await getFieldMappings(categoryId);
  const marcaPath = mappingLookup(mappings, "marca") ?? "__none__";
  const modeloPath = mappingLookup(mappings, "modelo") ?? "__none__";
  const proveedorPath = mappingLookup(mappings, "proveedor") ?? "nombre";
  const unidadesPath = mappingLookup(mappings, "unidades") ?? "cant_decla_item";

  await query(`delete from monthly_brand_model_agg where category_id = $1`, [categoryId]);

  await query(
    `insert into monthly_brand_model_agg
       (category_id, period, marca, modelo, proveedor, color, segmento, total_fob_dolars, total_unidades, record_count)
     select
       tr.category_id,
       tr.period,
       case
         when $2::text = '__none__' then coalesce(rbm.marca, pbm.marca, tr.marca, 'sin_identificar')
         else tr.raw ->> $2::text
       end as marca,
       case
         when $3::text = '__none__' then coalesce(rbm.modelo, pbm.modelo, tr.modelo)
         else tr.raw ->> $3::text
       end as modelo,
       coalesce(tr.raw ->> $4::text, 'sin_dato') as proveedor,
       coalesce(rbm.color, pbm.color, tr.color, 'sin_dato') as color,
       coalesce(tr.segmento, 'sin_dato') as segmento,
       sum(coalesce(tr.fob_dolars, 0)) as total_fob_dolars,
       sum(coalesce(nullif(tr.raw ->> $5::text, '')::numeric, 0)) as total_unidades,
       count(*) as record_count
     from trade_records tr
     left join provider_brand_map pbm
       on pbm.category_id = tr.category_id
      and pbm.importer_name = tr.raw ->> $4::text
     left join record_brand_map rbm
       on rbm.trade_record_id = tr.id
     where tr.category_id = $1
     -- Se agrupa por posicion (1..7, las columnas no-agregadas) y no por
     -- nombre: "marca" y "modelo" son tambien nombres de columnas reales en
     -- provider_brand_map/record_brand_map/trade_records, y Postgres
     -- prioriza esa columna sobre el alias del SELECT, lo que rompia el
     -- group by con "column tr.raw must appear in..."
     group by 1, 2, 3, 4, 5, 6, 7`,
    [categoryId, marcaPath, modeloPath, proveedorPath, unidadesPath]
  );
}
