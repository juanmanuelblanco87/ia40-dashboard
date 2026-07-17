/**
 * Cliente minimo para la API de OpenAI (Responses API), usado por el
 * "tamizador de segmentos" (app/api/sieve/route.ts) para determinar el
 * segmento real de un producto -- y, para las categorias de NCM compartido
 * (andadores / bastones / calzado_ortopedico), tambien la categoria real, ya
 * que la clasificacion automatica original (por marca + descripcion
 * aduanera generica) puede equivocarse cuando un fabricante vende varios
 * tipos de producto bajo codigos similares (caso real: "Double Care Medical
 * HY7300L" quedo clasificado como andador por el parser, pero es un
 * baston tripode segun la ficha real del producto).
 *
 * HISTORIA (17/07/2026): se probo primero con Gemini + tool "google_search"
 * (grounding nativo), pero ese tool devuelve 429 en el 100% de los casos si
 * el proyecto de Google AI Studio no tiene facturacion activada (Tier 1) --
 * ver historial completo en docs/PROYECTO.md seccion 10.1. La empresa
 * decidio pagar la API de OpenAI en su lugar (proyecto "cobus" en
 * platform.openai.com), asi que este archivo ahora usa OpenAI en vez de
 * Gemini. IMPORTANTE: esto NO es lo mismo que una suscripcion de ChatGPT
 * Plus/Pro -- es facturacion de plataforma, por uso, en platform.openai.com.
 *
 * Usa la Responses API (`https://api.openai.com/v1/responses`, el endpoint
 * moderno de OpenAI, no la Chat Completions API vieja) con el tool nativo
 * `web_search` -- el modelo busca en la web por su cuenta durante la misma
 * llamada, sin depender de SerpApi ni de ningun otro proveedor de busqueda.
 *
 * Nota tecnica importante: NO se usa "structured output" (`text.format:
 * json_schema`) combinado con el tool `web_search`. Hay reportes conocidos
 * de la comunidad de OpenAI de que esa combinacion corta la respuesta a la
 * mitad y rompe el JSON (mismo tipo de problema que tuvimos con Gemini al
 * combinar grounding + JSON mode). Por eso se le pide al modelo en el
 * prompt que responda SOLO con JSON en texto plano, y `extractJson()`
 * (parser de llaves balanceadas) lo extrae de forma tolerante.
 *
 * Requiere una variable de entorno en Vercel:
 *   - OPENAI_API_KEY: API key de platform.openai.com (proyecto "cobus"),
 *     facturacion por uso ya configurada por la empresa. Costo aproximado:
 *     el tool `web_search` cuesta USD 0.01 por busqueda (10 USD / 1000
 *     llamadas) + tokens de la respuesta al precio normal del modelo -- un
 *     lote de 20 productos sale centavos de dolar.
 */

const OPENAI_MODEL = "gpt-5.4-mini";

export interface CategoriaOpcion {
  slug: string;
  nombre: string;
  segmentos: string[];
}

export interface SieveClassifyParams {
  marca: string;
  modelo: string;
  categoriaActualSlug: string;
  categoriaActualNombre: string;
  /** Segmentos validos de la categoria ACTUAL (se ignora si hay opcionesCategoria). */
  segmentosValidos: string[];
  /** Solo para categorias de NCM compartido (andadores/bastones/calzado_ortopedico):
   * cada opcion trae SUS PROPIOS segmentos validos, porque cambiar de categoria
   * tambien cambia la lista de segmentos posibles. */
  opcionesCategoria?: CategoriaOpcion[];
}

export interface SieveClassifyResult {
  /** Slug de la categoria real, o null si coincide con la actual / no aplica. */
  categoriaSlug: string | null;
  /** Segmento sugerido, o null si no se pudo determinar con la evidencia disponible. */
  segmento: string | null;
  confianza: "alta" | "media" | "baja";
  razonamiento: string;
}

export class AiClassifierError extends Error {}

function buildPrompt(p: SieveClassifyParams): string {
  const opcionesCategoriaTexto = p.opcionesCategoria?.length
    ? `\nEste producto pertenece a un codigo arancelario que varios fabricantes usan para VARIOS tipos de producto distintos. Las categorias posibles, cada una con SUS PROPIOS segmentos validos, son:\n${p.opcionesCategoria
        .map((o) => `- ${o.slug} ("${o.nombre}"): segmentos posibles: ${o.segmentos.join(" | ")}`)
        .join(
          "\n"
        )}\nDevolve en "categoria_slug" cual de estos slugs corresponde de verdad al producto (puede ser la misma categoria actual: "${p.categoriaActualSlug}", si esta bien clasificado), y en "segmento" EXACTAMENTE uno de los segmentos listados para ESA categoria (no mezcles segmentos de otra categoria de la lista).`
    : `\nEsta categoria no tiene alternativas de re-clasificacion (dejar "categoria_slug" en null). Segmentos validos (elegi EXACTAMENTE uno de esta lista):\n${p.segmentosValidos
        .map((s) => `- ${s}`)
        .join("\n")}`;

  return `Sos un clasificador de productos de equipamiento medico/ortopedico para un dashboard de comercio exterior argentino.

Tenes acceso a busqueda web. Usala para buscar "${p.marca} ${p.modelo}" (y variantes razonables de esa marca + modelo/codigo si la primera busqueda no da resultados utiles) y averiguar que tipo de producto es realmente, antes de responder.

Producto a clasificar:
- Marca (declarada en aduana): ${p.marca}
- Modelo/codigo (declarado en aduana): ${p.modelo}
- Categoria actual en el sistema: ${p.categoriaActualNombre} (slug: ${p.categoriaActualSlug})
${opcionesCategoriaTexto}

Basandote en lo que encuentres buscando en la web, elegi SIEMPRE el segmento que mejor se ajuste al producto -- incluso si la evidencia es parcial, indirecta o ambigua (por ejemplo, si no encontras el modelo exacto pero si otros productos de la misma marca, o el nombre/codigo del modelo da una pista razonable del tipo de producto). NUNCA dejes "segmento" en null: usa el campo "confianza" para indicar que tan seguro estas ("baja" si tuviste que inferir con poca evidencia), pero elegi igual la opcion mas probable de la lista. Dejar "categoria_slug" en null (o igual a la categoria actual) si no hay evidencia clara de que el producto sea de otra categoria -- ese cambio si requiere mas certeza porque mueve la fila a otro lugar del sistema.

Respondé SOLO con un JSON valido, sin backticks, sin markdown y sin texto antes o despues, con este formato exacto:
{"categoria_slug": string o null, "segmento": string (nunca null, elegi el mas probable), "confianza": "alta"|"media"|"baja", "razonamiento": "explicacion breve en 1-2 oraciones, mencionando que encontraste en la busqueda y si fue una inferencia indirecta"}`;
}

/**
 * Extrae el primer objeto JSON balanceado del texto de respuesta (cuenta
 * llaves en vez de usar un regex "greedy" simple, por si el modelo agrega
 * algo de texto alrededor a pesar de la instruccion de responder solo JSON).
 */
function extractJson(text: string): any {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new AiClassifierError(`No se encontro JSON en la respuesta de OpenAI: ${text.slice(0, 300)}`);
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
          throw new AiClassifierError(`JSON invalido en la respuesta de OpenAI: ${candidate.slice(0, 300)}`);
        }
      }
    }
  }
  throw new AiClassifierError(`JSON incompleto en la respuesta de OpenAI: ${text.slice(0, 300)}`);
}

/**
 * Extrae el texto final del modelo de una respuesta de la Responses API.
 * El SDK oficial de OpenAI expone un `response.output_text` de conveniencia,
 * pero aca se llama a la API cruda con fetch, asi que hay que recorrer
 * `output` a mano: es un array de "items" (uno por cada paso -- puede haber
 * un item `web_search_call` antes del item final `message`), y el texto
 * esta en `content[].text` del item de tipo "message".
 */
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

export async function classifyProduct(params: SieveClassifyParams): Promise<SieveClassifyResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiClassifierError("Falta la variable de entorno OPENAI_API_KEY en Vercel.");
  }

  const prompt = buildPrompt(params);

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: [{ type: "web_search" }],
      input: prompt,
    }),
  });

  if (resp.status === 429) {
    throw new AiClassifierError("Limite de uso de OpenAI alcanzado (429) -- probá de nuevo en un rato.");
  }
  if (!resp.ok) {
    throw new AiClassifierError(`OpenAI API respondio ${resp.status}: ${await resp.text()}`);
  }

  const data: any = await resp.json();

  if (data?.status === "failed" || data?.error) {
    throw new AiClassifierError(`OpenAI devolvio error: ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
  }

  const text = extractOutputText(data);
  if (!text) {
    throw new AiClassifierError(`OpenAI no devolvio texto. Respuesta cruda: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const parsed = extractJson(text);

  const categoriaSlug: string | null =
    typeof parsed.categoria_slug === "string" && parsed.categoria_slug.trim() ? parsed.categoria_slug.trim() : null;
  const segmento: string | null =
    typeof parsed.segmento === "string" && parsed.segmento.trim() ? parsed.segmento.trim() : null;
  const confianza: "alta" | "media" | "baja" =
    parsed.confianza === "alta" || parsed.confianza === "media" || parsed.confianza === "baja"
      ? parsed.confianza
      : "baja";

  return {
    categoriaSlug,
    segmento,
    confianza,
    razonamiento: String(parsed.razonamiento ?? ""),
  };
}
