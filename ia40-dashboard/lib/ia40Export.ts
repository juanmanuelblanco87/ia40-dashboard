/**
 * Cliente para el flujo de EXPORTACION de IA40 (Cobus Group), que es la
 * unica forma de obtener la columna "SUB ITEMS - SUFIJOS" (necesaria para
 * detectar marca/modelo automaticamente) y "SUB ITEMS - P.U. U$S". El
 * endpoint /data normal no trae esas columnas.
 *
 * Flujo real (capturado con DevTools mientras se exportaba a mano):
 *   1. POST /export/data  -> dispara la generacion del archivo. Responde
 *      enseguida con { link, processId, notificationId }. El archivo
 *      todavia puede no estar listo en ese momento.
 *   2. GET /notification/{notificationId} -> hay que consultarlo (con
 *      espera entre intentos) hasta que devuelva state:"FINISH". El campo
 *      "value" de esa respuesta es el link final de descarga (S3).
 *   3. Descargar ese link (CSV plano, sin auth adicional).
 */

import { query } from "./db";

const BASE_URL = "https://api.cobusgroup.com/api/v1/f";
const MAX_TOKEN_AGE_MIN = 20;

export class Ia40AuthError extends Error {}

async function getStoredJwt(): Promise<string> {
  const rows = await query<{ value: string; updated_at: string }>(
    `select value, updated_at from app_settings where key = 'ia40_jwt'`
  );
  if (rows.length === 0) {
    throw new Ia40AuthError("No hay token guardado todavia (corre refresh_token.py al menos una vez).");
  }
  const ageMin = (Date.now() - new Date(rows[0].updated_at).getTime()) / 60000;
  if (ageMin > MAX_TOKEN_AGE_MIN) {
    throw new Ia40AuthError(`El token guardado tiene ${ageMin.toFixed(1)} min, parece vencido.`);
  }
  return rows[0].value;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "x-tool-request": "IA",
    "Content-Type": "application/json",
    Origin: "https://ia40.cobusgroup.com",
    Referer: "https://ia40.cobusgroup.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
}

export interface Filter {
  field: string;
  values: string[];
}

interface TriggerExportParams {
  countryCodi: string;
  informationTypeCodi: string;
  operationTypeCodi: string;
  dateStart: string;
  dateEnd: string;
  filters: Filter[];
  exportName: string;
}

interface TriggerExportResult {
  link: string;
  processId: number;
  notificationId: number;
}

async function triggerExport(token: string, p: TriggerExportParams): Promise<TriggerExportResult> {
  const body = {
    countryCodi: p.countryCodi,
    informationTypeCodi: p.informationTypeCodi,
    operationTypeCodi: p.operationTypeCodi,
    dateRange: { start: p.dateStart, end: p.dateEnd },
    filters: p.filters,
    filtersOverwrites: { operator: {} },
    order: "fecha",
    orderType: "desc",
    pager: { start: 0, limit: 20 },
    ranking: "",
    stats: [],
    export: {
      name: p.exportName,
      ranking: "",
      fieldsConfig: { type: "all", fields: [] },
      format: "csv",
      separator: ";",
      textQualifier: '"',
      decimalSeparator: ",",
    },
  };

  const resp = await fetch(`${BASE_URL}/export/data`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (resp.status === 401) {
    throw new Ia40AuthError("JWT invalido/expirado al pedir la exportacion.");
  }
  if (!resp.ok) {
    throw new Error(`export/data respondio ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

async function checkNotification(
  token: string,
  notificationId: number
): Promise<{ state: string; value: string | null }> {
  const resp = await fetch(`${BASE_URL}/notification/${notificationId}`, {
    headers: headers(token),
    cache: "no-store",
  });
  if (resp.status === 401) {
    throw new Ia40AuthError("JWT invalido/expirado al consultar la notificacion.");
  }
  if (!resp.ok) {
    throw new Error(`notification respondio ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

async function waitForExportFile(
  token: string,
  notificationId: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await checkNotification(token, notificationId);
    if (status.state === "FINISH" && status.value) {
      return status.value;
    }
    if (status.state === "ERROR" || status.state === "FAILED") {
      throw new Error(`La exportacion en IA40 termino con estado ${status.state}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timeout esperando que la exportacion de IA40 termine.");
}

async function downloadExportFile(url: string): Promise<string> {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`No se pudo descargar el archivo de exportacion (${resp.status})`);
  }
  return resp.text();
}

/**
 * Parser de CSV simple para el separador ";" con calificador de texto '"'
 * (la config que usa IA40). No es un parser CSV general de proposito
 * completo, pero cubre bien el caso real de estos exports.
 */
function parseExportCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  function splitLine(line: string): string[] {
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ";") {
        fields.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    return fields;
  }

  const headerCols = splitLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    const row: Record<string, string> = {};
    headerCols.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

/** "12.480,50" o "32,00" (formato arg, coma decimal) -> 12480.5 / 32 */
function parseArgNumber(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Pide la exportacion completa (con Sufijos) para un rango de fechas +
 * filtro de posicion arancelaria, espera a que termine, la descarga, y
 * devuelve filas normalizadas con las MISMAS claves que ya usa el resto
 * del pipeline (nombre, fecha, fob_dolars_item, cant_decla_item, etc.),
 * mas dos claves nuevas: "sufijos" y "precio_unitario", para el parser de
 * marca/modelo.
 */
export async function fetchIa40ExportRows(params: {
  countryCodi: string;
  informationTypeCodi: string;
  operationTypeCodi: string;
  dateStart: string;
  dateEnd: string;
  ncmCode: string;
}): Promise<any[]> {
  const token = await getStoredJwt();

  const { notificationId } = await triggerExport(token, {
    countryCodi: params.countryCodi,
    informationTypeCodi: params.informationTypeCodi,
    operationTypeCodi: params.operationTypeCodi,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    filters: [{ field: "posicion_arancelaria", values: [params.ncmCode] }],
    exportName: `SYNC_${params.ncmCode}_${Date.now()}`,
  });

  const downloadUrl = await waitForExportFile(token, notificationId);
  const csvText = await downloadExportFile(downloadUrl);
  const csvRows = parseExportCsv(csvText);

  return csvRows.map((row) => ({
    nombre: row["RAZÓN SOCIAL"] ?? "",
    cuit: row["CUIT"] ?? null,
    fecha: row["FECHA"] ?? null,
    despacho: row["DESPACHO"] ?? null,
    item: row["ITEM"] ?? null,
    aduana_desc: row["ADUANA"] ?? null,
    posicion_arancelaria: row["POSICIÓN ARANCELARIA"] ?? null,
    posicion_descripcion: row["DESCRIPCIÓN DE LA POSICIÓN"] ?? null,
    fob_dolars_item: parseArgNumber(row["SUB ITEMS - FOB U$S"]),
    cant_decla_item: parseArgNumber(row["SUB ITEMS - CANTIDAD"]),
    precio_unitario: parseArgNumber(row["SUB ITEMS - P.U. U$S"]),
    sufijos: row["SUB ITEMS - SUFIJOS"] ?? "",
  }));
}
