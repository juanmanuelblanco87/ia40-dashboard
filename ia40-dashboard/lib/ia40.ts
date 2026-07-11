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

function dumpHeaders(resp: Response): Record<string, string> {
  const all: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    all[key] = value;
  });
  return all;
}

async function login(): Promise<string> {
  const username = process.env.IA40_USERNAME;
  const password = process.env.IA40_PASSWORD;
  if (!username || !password) {
    throw new Error("Faltan IA40_USERNAME / IA40_PASSWORD en las variables de entorno.");
  }

  const body = new URLSearchParams({ login: username, pass: password, sistema: "1" });

  const resp = await fetch("https://www.cobusgroup.com/program/connection.inc.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });

  const loginAllHeaders = dumpHeaders(resp);

  const rawCookies: string[] =
    (resp.headers as any).getSetCookie?.() ??
    (resp.headers.get("set-cookie") ? [resp.headers.get("set-cookie") as string] : []);

  const sessionCookie = rawCookies
    .map((c) => c.match(/PHPSESSID=([^;]+)/)?.[1])
    .find(Boolean);

  const text = await resp.text();

  if (!sessionCookie) {
    throw new Ia40AuthError(
      `El login no devolvio PHPSESSID (status ${resp.status}). Headers: ${JSON.stringify(
        loginAllHeaders
      )}. Body: ${text.slice(0, 500)}`
    );
  }

  if (text.includes("datos_incorrectos")) {
    throw new Ia40AuthError("Usuario o contrasena incorrectos (IA40_USERNAME / IA40_PASSWORD).");
  }
  if (text.includes("vencido") || text.includes("finalizado")) {
    throw new Ia40AuthError("El abono de Cobus esta vencido o finalizado.");
  }
  if (text.includes("deshabilitado")) {
    throw new Ia40AuthError("El usuario esta deshabilitado. Contactar a Cobus.");
  }

  return sessionCookie;
}

async function getFreshJwt(): Promise<string> {
  const sessionCookie = await login();

  const resp = await fetch("https://www.cobusgroup.com/redirect-ia40", {
    headers: { Cookie: `PHPSESSID=${sessionCookie}` },
    redirect: "manual",
  });

  const allHeaders = dumpHeaders(resp);
  const location = resp.headers.get("location");

  if (!location) {
    const bodySnippet = (await resp.text()).slice(0, 500);
    throw new Ia40AuthError(
      `redirect-ia40 no devolvio Location (status ${resp.status}). Cookie usada: ${sessionCookie.slice(
        0,
        10
      )}... Headers: ${JSON.stringify(allHeaders)}. Body: ${bodySnippet}`
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
      throw new Ia40AuthError("El token recien obtenido fue rechazado (401).");
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
