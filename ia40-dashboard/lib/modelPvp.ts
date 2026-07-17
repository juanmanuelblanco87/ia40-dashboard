import { query } from "./db";
import { findModelPvp, PvpFinderError } from "./pvpFinder";

export interface ModelPvpEntry {
  marca: string;
  modelo: string;
  pvp_usd: number | null;
  confianza: string | null;
  fuentes_consistentes: number | null;
  razonamiento: string | null;
  status: string; // 'pending' | 'found' | 'not_found' | 'error'
}

/**
 * Busca (o devuelve de cache) el PVP estimado en USD de una combinacion
 * marca/modelo. Igual que getOrSearchModelImage (lib/modelImages.ts): pensado
 * para llamarse ON DEMAND desde el front (click en "Consultar precio"), no en
 * un cron masivo. Si ya hay un resultado 'found' o 'not_found' guardado, lo
 * devuelve directo sin gastar una llamada nueva a OpenAI. Solo reintenta si
 * no hay fila todavia o si la ultima vez quedo en 'error'.
 */
export async function getOrSearchModelPvp(
  categoryId: number,
  categoryName: string,
  marca: string,
  modelo: string
): Promise<ModelPvpEntry> {
  const existing = await query<ModelPvpEntry>(
    `select marca, modelo, pvp_usd, confianza, fuentes_consistentes, razonamiento, status
     from model_pvp
     where category_id = $1 and marca = $2 and modelo = $3`,
    [categoryId, marca, modelo]
  );

  if (existing.length > 0 && (existing[0].status === "found" || existing[0].status === "not_found")) {
    return existing[0]; // ya cacheado, no gastamos una llamada nueva a OpenAI
  }

  try {
    const result = await findModelPvp(marca, modelo, categoryName);
    const status = result.pvpUsd != null ? "found" : "not_found";
    await query(
      `insert into model_pvp (category_id, marca, modelo, pvp_usd, confianza, fuentes_consistentes, razonamiento, status, fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (category_id, marca, modelo) do update set
         pvp_usd = excluded.pvp_usd,
         confianza = excluded.confianza,
         fuentes_consistentes = excluded.fuentes_consistentes,
         razonamiento = excluded.razonamiento,
         status = excluded.status,
         fetched_at = now(),
         error_message = null`,
      [categoryId, marca, modelo, result.pvpUsd, result.confianza, result.fuentesConsistentes, result.razonamiento, status]
    );
    return {
      marca,
      modelo,
      pvp_usd: result.pvpUsd,
      confianza: result.confianza,
      fuentes_consistentes: result.fuentesConsistentes,
      razonamiento: result.razonamiento,
      status,
    };
  } catch (err: any) {
    await query(
      `insert into model_pvp (category_id, marca, modelo, status, error_message, fetched_at)
       values ($1, $2, $3, 'error', $4, now())
       on conflict (category_id, marca, modelo) do update set
         status = 'error', error_message = excluded.error_message, fetched_at = now()`,
      [categoryId, marca, modelo, String(err?.message ?? err)]
    );
    if (err instanceof PvpFinderError) throw err;
    return {
      marca,
      modelo,
      pvp_usd: null,
      confianza: null,
      fuentes_consistentes: null,
      razonamiento: null,
      status: "error",
    };
  }
}
