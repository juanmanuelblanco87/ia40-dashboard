/**
 * Cliente minimo para la API de Gemini (Google AI Studio), usado por el
 * "tamizador de segmentos" (app/api/sieve/route.ts) para determinar el
 * segmento real de un producto -- y, para las categorias de NCM compartido
 * (andadores / bastones / calzado_ortopedico), tambien la categoria real, ya
 * que la clasificacion automatica original (por marca + descripcion
 * aduanera generica) puede equivocarse cuando un fabricante vende varios
 * tipos de producto bajo codigos similares (caso real: "Double Care Medical
 * HY7300L" quedo clasificado como andador por el parser, pero es un
 * baston tripode segun la ficha real del producto).
 *
 * IMPORTANTE (17/07/2026, pedido explicito del usuario): este cliente NO
 * depende de SerpApi para buscar evidencia. Antes se buscaba "<marca>
 * <modelo>" con SerpApi (lib/webSearch.ts) y se le pasaban los snippets a
 * Gemini como texto. Ahora se usa la herramienta nativa de Gemini
 * "google_search" (grounding) -- el propio modelo busca en la web durante
 * la llamada, sin gastar cuota de SerpApi. SerpApi queda reservada
 * exclusivamente para pegar la IMAGEN del producto al catalogo
 * (lib/imageSearch.ts, sin cambios), que es un flujo completamente aparte.
 *
 * Nota tecnica: gemini-3.1-flash-lite (el modelo usado) todavia NO soporta
 * combinar "structured output" (generationConfig.responseMimeType /
 * responseSchema) con herramientas como google_search -- esa combinacion
 * solo esta disponible (en preview) para gemini-3.1-pro-preview y
 * gemini-3.5-flash (ver
 * https://ai.google.dev/gemini-api/docs/generate-content/structured-output#structured-outputs-with-tools).
 * Por eso NO se pide JSON mode: se le pide a Gemini en el prompt que
 * responda SOLO con el JSON (sin backticks ni texto alrededor), y
 * `extractJson()` lo extrae del texto de forma tolerante (busca el primer
 * bloque `{...}` balanceado, por si el modelo agrega algo de texto antes o
 * despues a pesar de la instruccion).
 *
 * Requiere una variable de entorno en Vercel:
 *   - GEMINI_API_KEY: API key GRATIS de aistudio.google.com (Google AI
 *     Studio) -- no pide tarjeta, solo tiene limite de uso (rate limit),
 *     no de dinero.
 *
 *   Nota (17/07/2026): originalmente se uso "gemini-2.5-flash-lite", pero
 *   Google dejo de darle acceso a ese modelo a API keys nuevas (empezo a
 *   devolver 404 "no longer available to new users" el 9/jul/2026, aunque
 *   la pagina de deprecations todavia lo lista con fecha de baja en
 *   octubre 2026 -- parece un corte solo para cuentas nuevas). Se cambio a
 *   "gemini-3.1-flash-lite" (linea Gemini 3, modelo estable equivalente en
 *   costo/latencia, tambien gratis en Google AI Studio, y con soporte de
 *   "Search grounding"). Si esto vuelve a pasar, revisar el modelo actual
 *   en https://ai.google.dev/gemini-api/docs/models y actualizar
 *   GEMINI_MODEL abajo (verificar que el reemplazo soporte el tool
 *   "google_search").
 */

const GEMINI_MODEL = "gemini-3.1-flash-lite";

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

Tenes acceso a busqueda de Google (herramienta google_search). Usala para buscar "${p.marca} ${p.modelo}" (y variantes razonables de esa marca + modelo/codigo si la primera busqueda no da resultados utiles) y averiguar que tipo de producto es realmente, antes de responder.

Producto a clasificar:
- Marca (declarada en aduana): ${p.marca}
- Modelo/codigo (declarado en aduana): ${p.modelo}
- Categoria actual en el sistema: ${p.categoriaActualNombre} (slug: ${p.categoriaActualSlug})
${opcionesCategoriaTexto}

Basandote en lo que encuentres buscando en la web (si la busqueda no da resultados utiles o es ambigua, decilo con confianza "baja" y dejar "segmento" en null en vez de adivinar), respondé SOLO con un JSON valido, sin backticks, sin markdown y sin texto antes o despues, con este formato exacto:
{"categoria_slug": string o null, "segmento": string o null, "confianza": "alta"|"media"|"baja", "razonamiento": "explicacion breve en 1-2 oraciones, mencionando que encontraste en la busqueda"}`;
}

/**
 * Extrae el primer objeto JSON balanceado del texto de respuesta. Se usa un
 * conteo de llaves en vez de un regex simple porque, al no poder pedir JSON
 * mode junto con el tool de busqueda (ver nota tecnica arriba), Gemini puede
 * agregar texto o un bloque ```json``` alrededor del objeto a pesar de la
 * instruccion -- esto evita que un regex "greedy" agarre de mas si hay
 * llaves sueltas en el texto circundante.
 */
function extractJson(text: string): any {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new AiClassifierError(`No se encontro JSON en la respuesta de Gemini: ${text.slice(0, 300)}`);
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
          throw new AiClassifierError(`JSON invalido en la respuesta de Gemini: ${candidate.slice(0, 300)}`);
        }
      }
    }
  }
  throw new AiClassifierError(`JSON incompleto en la respuesta de Gemini: ${text.slice(0, 300)}`);
}

export async function classifyProduct(params: SieveClassifyParams): Promise<SieveClassifyResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiClassifierError("Falta la variable de entorno GEMINI_API_KEY en Vercel.");
  }

  const prompt = buildPrompt(params);

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Grounding con Google Search: el modelo busca en la web por su
        // cuenta durante la llamada (sin SerpApi). No se puede combinar con
        // generationConfig.responseMimeType en este modelo -- ver nota
        // tecnica arriba.
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1 },
      }),
    }
  );

  if (resp.status === 429) {
    throw new AiClassifierError("Limite de uso gratis de Gemini alcanzado (429) -- probá de nuevo en un rato.");
  }
  if (!resp.ok) {
    throw new AiClassifierError(`Gemini API respondio ${resp.status}: ${await resp.text()}`);
  }

  const data: any = await resp.json();

  if (data.promptFeedback?.blockReason) {
    throw new AiClassifierError(`Gemini bloqueo la respuesta: ${data.promptFeedback.blockReason}`);
  }

  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    throw new AiClassifierError(`Gemini no devolvio texto. Respuesta cruda: ${JSON.stringify(data).slice(0, 300)}`);
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
