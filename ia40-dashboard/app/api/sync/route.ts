/**
 * Registro de parsers de marca/modelo por categoria. Cada categoria puede
 * tener su propio parser adaptado (los datos de aduana no son uniformes
 * entre categorias). Si una categoria no tiene parser registrado ahi, el
 * sync sigue usando el flujo normal (/data) y la clasificacion manual
 * (provider_brand_map / record_brand_map) como hasta ahora.
 */

import { parseMarcaModeloSillasDeRuedas } from "./sillasDeRuedas";

export interface ParsedBrandModel {
  marca: string;
  modelo: string;
}

export type CategoryParser = (raw: Record<string, any>) => ParsedBrandModel | null;

export const CATEGORY_PARSERS: Record<string, CategoryParser> = {
  sillas_de_ruedas: (raw) => {
    if (!raw.sufijos) return null;
    return parseMarcaModeloSillasDeRuedas(raw.sufijos, raw.nombre ?? "", raw.precio_unitario ?? null);
  },
};

/** Categorias que necesitan el flujo de EXPORTACION (con Sufijos) en vez de /data normal. */
export function categoryUsesExportFlow(categorySlug: string): boolean {
  return categorySlug in CATEGORY_PARSERS;
}
