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

function extractAllCookies(resp: Response): Record<string, string> {
  const rawCookies: string[] =
    (resp.headers as any).getSetCookie?.() ??
    (resp.headers.get("set-cookie") ? [resp.headers.get("set-cookie") as string] : []);
  const cookies: Record<string, string> = {};
  for (const raw of rawCookies) {
    const match = raw.match(/^([^=]+)=([^;]*)/);
    if (match) cookies[match[1].trim()] = match[2];
  }
  return cookies;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

interface LoginResult {
  cookies: Record<string, string>;
  loginBody: string;
}

async function login(): Promise<LoginResult> {
  const username = process.env.IA40_USERNAME;
  const password = process.env.IA40_PASSWORD;
  if (!username || !password) {
    throw new Error("Faltan IA40_USERNAME / IA40_PASSWORD en las variables de entorno.");
  }

  const initialResp = await fetch("https://www.cobusgroup.com/html2/cobus1login.html", {
    redirect: "manual",
    cache: "no-store",
  });
  let cookies = extractAllCookies(initialResp);

  if (!cookies.PHPSESSID) {
    throw new Ia40AuthError("No se pudo conseguir una cookie de sesion inicial antes del login.");
  }

  const body = new URLSearchParams({ login: username, pass: password, sistema: "1" });

  const resp = await fetch("https://www.cobusgroup.com/program/connection.inc.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(cookies),
      Referer: "https://www.cobusgroup.com/html2/cobus1login.html",
    },
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const loginAllHeaders = dumpHeaders(resp);
  const newCookies = extractAllCookies(resp);
  cookies = { ...cookies, ...newCookies };
  const text = await resp.text();

  if (text.includes("datos_incorrectos")) {
    throw new Ia40AuthError("Usuario o contrasena incorrectos (IA40_USERNAME / IA40_PASSWORD).");
  }
  if (text.includes("vencido") || text.includes("finalizado")) {
    throw new Ia40AuthError("El abono de Cobus esta vencido o finalizado.");
  }
  if (text.includes("deshabilitado")) {
    throw new Ia40AuthError("El usuario esta deshabilitado. Contactar a Cobus.");
  }
  if (!text || text.trim().length === 0) {
    throw new Ia40AuthError(
      `El login devolvio body vacio (status ${resp.status}). Headers: ${JSON.stringify(loginAllHeaders)}`
    );
  }

  return { cookies, loginBody: text };
}

async function getFreshJwt(): Promise<string> {
  const { cookies, loginBody } = await login();

  const resp = await fetch("https://www.cobusgroup.com/redirect-ia40", {
    headers: { Cookie: cookieHeader(cookies) },
    redirect: "manual",
    cache: "no-store",
  });

  const allHeaders = dumpHeaders(resp);
  const location = resp.headers.get("location");

  if (!location) {
    const bodySnippet = (await resp.text()).slice(0, 500);
    throw new Ia40AuthError(
      `redirect-ia40 no devolvio Location (status ${resp.status}). Login body: ${loginBody.slice(
        0,
        300
      )}. Cookies usadas: ${Object.keys(cookies).join(",")}. Headers: ${JSON.stringify(
        allHeaders
      )}. Body: ${bodySnippet}`
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
      cache: "no-store",
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
