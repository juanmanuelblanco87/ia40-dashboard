/**
 * Cliente IA40 (Cobus Group) en TypeScript, version para correr dentro
 * de un API route de Next.js (usado por /api/sync).
 *
 * Requiere IA40_JWT valido en el entorno. La API no tiene endpoint de
 * login documentado -> el token se extrae a mano del navegador y se
 * carga como variable de entorno en Vercel. Cuando expira, /api/sync
 * empieza a devolver 401 y hay que actualizarlo.
 */

const BASE_URL = "https://api.cobusgroup.com/api/v1/f";
const PAGE_LIMIT = 50;

export interface Filter {
  field: string;
  values: string[];
}

export interface FetchDataParams {
  countryCodi: string;
  informationTypeCodi: string;
  operationTypeCodi: string;
  dateStart: string; // YYYY-MM-DD
  dateEnd: string;   // YYYY-MM-DD
  filters: Filter[];
  maxRecords?: number;
}

export class Ia40AuthError extends Error {}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "x-tool-request": "IA",
    "Content-Type": "application/json",
  };
}

export async function fetchIa40Data(params: FetchDataParams): Promise<{ rows: any[]; schema: any }> {
  const token = process.env.IA40_JWT;
  if (!token) throw new Error("Falta IA40_JWT en las variables de entorno.");

  const allRows: any[] = [];
  let schema: any = null;
  let start = 0;

  while (true) {
    const body = {
      countryCodi: params.countryCodi,
      informationTypeCodi: params.informationTypeCodi,
      operationTypeCodi: params.operationTypeCodi,
      dateRange: { start: params.dateStart, end: params.dateEnd },
      filters: params.filters,
      filtersOverwrites: { operator: {} },
      pager: { start, limit: PAGE_LIMIT },
      ranking: "",
      stats: [],
    };

    const resp = await fetch(`${BASE_URL}/data`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    });

    if (resp.status === 401) {
      throw new Ia40AuthError("JWT expirado o invalido. Actualiza IA40_JWT en Vercel.");
    }
    if (!resp.ok) {
      throw new Error(`IA40 respondio ${resp.status}: ${await resp.text()}`);
    }

    const payload = await resp.json();
    const rows: any[] = payload.data ?? [];
    if (schema === null) schema = payload.schema ?? null;
    allRows.push(...rows);

    if (params.maxRecords && allRows.length >= params.maxRecords) {
      return { rows: allRows.slice(0, params.maxRecords), schema };
    }
    if (rows.length < PAGE_LIMIT) break;
    start += PAGE_LIMIT;
  }

  return { rows: allRows, schema };
}
