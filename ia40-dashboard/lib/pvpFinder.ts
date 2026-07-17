/**
 * Cliente OpenAI (Responses API + tool nativo `web_search`) para estimar el
 * precio promedio actual de venta al publico (PVP) en USD de un modelo, ON
 * DEMAND (se llama al hacer click en "Consultar precio" en la tabla "Share
 * por Modelo" del dashboard), reusando el mismo enfoque que
 * lib/aiClassifier.ts (tamizador de segmentos): una sola llamada con el
 * tool `web_search`, sin structured output (json_schema no es compatible de
 * forma confiable con web_search, ver nota completa en aiClassifier.ts),
 * parseado con un extractor de JSON tolerante a texto extra.
 *
 * ACTUALIZACION (17/07/2026): la version anterior le pedia al modelo que
 * comparara precios de varias fuentes y devolviera un link de origen -- en
 * la practica terminaba agarrando el precio de UNA ficha tecnica encontrada
 * (a veces de un producto relacionado pero no exacto), en vez del precio de
 * mercado real. Ahora se le hace una pregunta simple y directa ("cual es el
 * precio promedio actual de X"), sin pedirle que elija ni justifique una
 * fuente puntual, y se le pide directamente el promedio si encuentra varios
 * precios. Ya NO se pide (ni se guarda) el link de origen: no aporta en esta
 * etapa (pedido explicito del usuario, 17/07/2026).
 *
 * OJO: este archivo repite (en vez de importar) la logica de llamada a la
 * Responses API que ya existe en aiClassifier.ts. Es una decision deliberada:
 * el tamizador ya esta probado en produccion y no queremos arriesgar esa
 * ruta tocandola para extraer un helper compartido. Si en el futuro se
 * agrega un tercer consumidor de la API de OpenAI, ahi si conviene
 * refactorizar ambos a un lib/openai.ts comun.
 *
 * Requiere la misma variable de entorno que el tamizador:
 *   - OPENAI_API_KEY: API key de platform.openai.com (proyecto "cobus").
 */

const OPENAI_MODEL = "gpt-5.4-mini";

export interface PvpResult {
  pvpUsd: number | null;
  confianza: "alta" | "media" | "baja";
  razonamiento: string;
}

export class PvpFinderError extends Error {}

function buildPrompt(marca: string, modelo: string, categoryName: string): string {
  return `Sos un investigador de precios de equipamiento medico/ortopedico para un dashboard de comercio exterior.

Pregunta simple: ¿Cual es el precio promedio actual de venta al publico, en dolares estadounidenses (USD), del siguiente producto?
- Marca: ${marca}
- Modelo/codigo: ${modelo}
- Tipo de producto: ${categoryName}

Buscá en la web precios de venta al publico ACTUALES de este producto especifico (tiendas online, distribuidores medicos, marketplaces, el sitio del fabricante) -- no uses el precio de una ficha tecnica o comparativa que no sea especificamente sobre este modelo. Si encontras varios precios, calculá el PROMEDIO entre ellos (convertilos a USD primero si estan en otra moneda). Si no encontras ningun precio de venta confiable para este modelo especifico, dejá "pvp_usd" en null (no inventes un numero).

Respondé SOLO con un JSON valido, sin backticks, sin markdown y sin texto antes o despues, con este formato exacto:
{"pvp_usd": number o null (el precio promedio en USD), "confianza": "alta"|"media"|"baja", "razonamiento": "explicacion breve en 1-2 oraciones: que precios encontraste y como calculaste el promedio"}`;
}

/**
 * Extrae el primer objeto JSON balanceado del texto (mismo enfoque que
 * extractJson en aiClassifier.ts).
 */
function extractJson(text: string): any {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new PvpFinderError(`No se encontro JSON en la respuesta de OpenAI: ${text.slice(0, 300)}`);
  }
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          throw new PvpFinderError(`JSON invalido en la respuesta de OpenAI: ${candidate.slice(0, 300)}`);
        }
      }
    }
  }
  throw new PvpFinderError(`JSON incompleto en la respuesta de OpenAI: ${text.slice(0, 300)}`);
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          return part.text;
        }
      }
    }
  }
  return "";
}

export async function findModelPvp(marca: string, modelo: string, categoryName: string): Promise<PvpResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new PvpFinderError("Falta la variable de entorno OPENAI_API_KEY en Vercel.");
  }

  const prompt = buildPrompt(marca, modelo, categoryName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        tools: [{ type: "web_search" }],
        reasoning: { effort: "low" },
        input: prompt,
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new PvpFinderError("OpenAI no respondio a tiempo (timeout de 45s) -- probá de nuevo.");
    }
    throw new PvpFinderError(`Error de red llamando a OpenAI: ${String(err?.message ?? err)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (resp.status === 429) {
    throw new PvpFinderError("Limite de uso de OpenAI alcanzado (429) -- probá de nuevo en un rato.");
  }
  if (!resp.ok) {
    throw new PvpFinderError(`OpenAI API respondio ${resp.status}: ${await resp.text()}`);
  }

  const data: any = await resp.json();

  if (data?.status === "failed" || data?.error) {
    throw new PvpFinderError(`OpenAI devolvio error: ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
  }

  const text = extractOutputText(data);
  if (!text) {
    throw new PvpFinderError(`OpenAI no devolvio texto. Respuesta cruda: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const parsed = extractJson(text);

  const pvpUsd: number | null =
    typeof parsed.pvp_usd === "number" && Number.isFinite(parsed.pvp_usd) && parsed.pvp_usd > 0
      ? parsed.pvp_usd
      : null;
  const confianza: "alta" | "media" | "baja" =
    parsed.confianza === "alta" || parsed.confianza === "media" || parsed.confianza === "baja"
      ? parsed.confianza
      : "baja";

  return {
    pvpUsd,
    confianza,
    razonamiento: String(parsed.razonamiento ?? ""),
  };
}
