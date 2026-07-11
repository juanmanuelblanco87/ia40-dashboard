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
  dateStart: string;
  dateEnd: string;
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

/**
 * Consigue un JWT fresco usando la cookie de sesion de www.cobusgroup.com
 * (PHPSESSID). Este endpoint es el mismo que usa el propio sitio para el
 * SSO entre el portal general y la herramienta IA40: dado que la cookie
 * todavia sea valida en el servidor, devuelve un token nuevo (dura ~15 min)
 * en el header Location de una redireccion 302.
 */
async function getFreshJwt(): Promise<string> {
  const sessionCookie = process.env.IA40_SESSION_COOKIE;
  if (!sessionCookie) {
    throw new Error("Falta IA40_SESSION_COOKIE en las variables de entorno.");
  }

  const resp = await fetch("https://www.cobusgroup.com/redirect-ia40", {
    headers: { Cookie: `PHPSESSID=${sessionCookie}` },
    redirect: "manual",
  });

  const location = resp.headers.get("location");
  if (!location) {
    throw new Ia40AuthError(
      "No se pudo renovar el token: la cookie de sesion probablemente vencio. Hay que volver a extraerla del navegador (ver README)."
    );
  }

  const url = new URL(location);
  const token = url.searchParams.get("token");
  if (!token) {
    throw new Ia40AuthError("redirect-ia40 no devolvio un token valido en la URL de redireccion.");
  }
  return token;
}

export async function fetchIa40Data(params: FetchDataParams): Promise<{ rows: any[]; schema: any }> {
  const token = await getFreshJwt();

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
      throw new Ia40AuthError("El token recien obtenido fue rechazado (401). Revisar IA40_SESSION_COOKIE.");
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
