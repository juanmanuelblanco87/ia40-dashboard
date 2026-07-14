/**
 * Registro de parsers de marca/modelo por categoria. Cada categoria puede
 * tener su propio parser adaptado (los datos de aduana no son uniformes
 * entre categorias). Si una categoria no tiene parser registrado ahi, el
 * sync sigue usando el flujo normal (/data) y la clasificacion manual
 * (provider_brand_map / record_brand_map) como hasta ahora.
 *
 * NOTA: el parser de "Sillas de ruedas" esta definido ACA MISMO (no en un
 * archivo aparte) a proposito, para evitar un import relativo entre
 * archivos que en este proyecto no se pudo resolver de forma consistente
 * en Vercel (el archivo lib/parsers/sillasDeRuedas.ts existia y tenia el
 * contenido correcto, pero el build fallaba igual con "Module not found").
 * Cuando se agregue el parser de la proxima categoria, se puede repetir
 * este mismo patron (todo en un solo archivo) o revisitar el import
 * separado si se identifica la causa real.
 */

export interface ParsedBrandModel {
  marca: string;
  modelo: string;
  color?: string;
}

export type CategoryParser = (raw: Record<string, any>) => ParsedBrandModel | null;

// ============================================================
// Parser: Sillas de ruedas
// ============================================================

// ---- Paso 5: diccionario multi-palabra (match mas largo primero) ----
const SILLAS_MULTI_WORD_DICT: [string, string][] = [
  ["FOSHAN DONGFANG MEDICAL EQUIPMENT MANUFACTORY LTD", "Foshan Dongfang Medical Equipment Manufactory Ltd"],
  ["INTCO MEDICAL INDUSTRIES INC", "Intco Medical Industries Inc"],
  ["INTCO MEDICAL INDUST", "Intco Medical Industries Inc"],
  ["CONVAID PRODUCTS LLC", "Convaid Products LLC"],
  ["JAMES LECKEY DESIGN", "James Leckey Design"],
  ["LIW CARE TECHNOLOGY", "LIW Care Technology"],
  ["PDG PRODUCT DESIGN", "PDG Product Design"],
  ["FOSHAN DONGFANG MEDI", "Foshan Dongfang Medical"],
  ["FOSHAN DONGFANG AND", "Foshan Dongfang"],
  ["FOSHAN RAFU MEDICAL", "Foshan Rafu Medical"],
  ["FOSHAN ENCARRE MEDICL", "Foshan Ecarre Medica"],
  ["FOSHAN ECARRE MEDICA", "Foshan Ecarre Medica"],
  ["FOSHAN ECARRE MEDIC", "Foshan Ecarre Medica"],
  ["JIANGSU INTCO MEDICA", "Jiangsu Intco Medica"],
  ["JIANGSU RIXIN MEDICA", "Jiangsu Rixin Medica"],
  ["GUANGDONG KAIYANG", "Guangdong Kaiyang"],
  ["KAIYANG MEDICAL", "Kaiyang Medical"],
  ["CIRCLE SPECIALTY", "Circle Specialty"],
  ["SUNRISE MEDICAL", "Sunrise Medical"],
  ["MOTION COMPOSITES", "Motion Composites"],
  ["MDH SP Z O O", "MDH SP Z.O.O."],
  ["SARL VIPAMAT", "Sarl Vipamat"],
  ["FUTURE MOBILITY HEAL", "Future Mobility Healthcare"],
  ["FUTURE MOBILITY", "Future Mobility Healthcare"],
  ["ALU REHAB", "Alu Rehab"],
  ["DOUBLE CARE MEDICAL", "Double Care Medical"],
  ["DOUBLE CARE", "Double Care Medical"],
  ["DRIVE MEDICAL", "Drive Medical"],
  ["STEALTH PRODUCTS", "Stealth Products"],
  ["KI MOBILITY", "KI Mobility"],
  ["FOSHAN GEGE", "Foshan Gege"],
  ["FOSHAN KAIYANG", "Foshan Kaiyang"],
  ["FOSHAN FEIYANG", "Foshan Feiyang"],
  ["FOSHAN ECARRE", "Foshan Ecarre Medica"],
  ["AKCES MED", "Akces Med"],
  ["TOP MEDI", "Top Medi"],
  ["U NURSE", "U Nurse"],
  ["CARE QUIP", "Care Quip"],
  ["BOX WHEELCHAIRS", "Box Wheelchairs"],
];
const SILLAS_MULTI_WORD_SORTED = [...SILLAS_MULTI_WORD_DICT].sort((a, b) => b[0].length - a[0].length);

// ---- Paso 6: marca de una sola palabra (tabla OVERRIDE) ----
const SILLAS_SINGLE_WORD_OVERRIDE: Record<string, string> = {
  TILITE: "TiLite",
  KI: "KI",
  HOGGI: "Hoggi",
  VERMEIREN: "Vermeiren",
  INVACARE: "Invacare",
  OTTOBOCK: "Ottobock",
  STRYKER: "Stryker",
  MEYRA: "Meyra",
  ASPEN: "Aspen",
  MAGESA: "Magesa",
  MUGI: "Mugi",
  INTCO: "Intco",
  MOVICARE: "Movicare",
  MYWAM: "MyWam",
  JIANLIAN: "Jianlian",
  YUWELL: "Yuwell",
  LIFECARE: "LifeCare",
  SUNCARE: "SunCare",
  ANTARES: "Antares",
  NEATECH: "NeaTech",
  ANATOMIC: "Anatomic",
  KARMA: "Karma",
  EUROMIX: "EuroMix",
  MAVERICK: "Maverick",
  COMFORT: "Comfort",
  LERADO: "Lerado",
  SITMED: "SitMed",
  POLIOR: "Polior",
  KDB: "KDB",
  WATER: "Water",
  NOVA: "Nova",
  ACHIEVE: "Achieve",
  REBOTEC: "Rebotec",
  ARIA: "Aria",
  MERITS: "Merits",
  RIFTON: "Rifton",
  VESCO: "Vesco",
  RGK: "RGK",
  LIGHTNING: "Lightning",
  PATRON: "Patron",
  GIGANTEX: "Gigantex",
  R82: "R82",
  SUNRISE: "Sunrise Medical",
  LIW: "LIW",
  OFFCARR: "Offcarr",
  LEGGERO: "Leggero",
  TIMO: "Timo",
  ORMESA: "Ormesa",
  ORTOBRAS: "Ortobras",
  "A&J": "A&J",
  FOSHAN: "Foshan",
  JIANGSU: "Jiangsu",
  GREEN: "Green",
  THOMASHILFEN: "Thomashilfen",
  ONE: "One",
  JEPOINT: "Jepoint",
  MEDCORE: "Medcore",
};

// ---- Paso 4: typos conocidos (primera palabra) ----
const SILLAS_TYPO_FIXES: Record<string, string> = {
  OTTOBOK: "OTTOBOCK",
  INVACORE: "INVACARE",
  LEGEGRO: "LEGGERO",
  SURISE: "SUNRISE",
  GUNAGDONG: "GUANGDONG",
  ANTOMIC: "ANATOMIC",
  LIGTHNING: "LIGHTNING",
  R52: "R82",
  TLITE: "TILITE",
};

// ---- Paso 7: palabras vacias societarias ----
const SILLAS_SOCIETARY_STOPWORDS = new Set([
  "S.A.", "SRL", "S.R.L.", "SOCIEDAD", "ANONIMA", "LTDA", "SOC", "RESP",
  "COMERCIAL", "E", "INDUSTRI", "Y", "CIA", "DE", "DEL", "LA", "EL",
  "SUCURSAL", "ARGENTINA", "INDUSTRIAL",
]);

function sillasTitleCase(word: string): string {
  if (word.length <= 3) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Paso 9: contador "Modelo N" correlativo por Razon Social + Precio Unitario.
// NOTA: este contador vive en memoria del proceso. Dentro de una misma
// corrida de sync es correcto (se reutiliza el mismo numero para la misma
// combinacion razonSocial+precio); entre corridas distintas (cada una un
// proceso nuevo en Vercel) se reinicia. Segun los datos reales analizados,
// este camino casi no se usa (casi todo trae un codigo de referencia
// utilizable como Modelo), asi que por ahora no se persiste en la base.
const sillasModeloAssigned = new Map<string, number>();
const sillasModeloCounterPerRazon = new Map<string, number>();

function sillasAssignModeloN(razonSocial: string, precioUnitario?: number | null): string {
  const razonUpper = razonSocial.toUpperCase();
  const key = `${razonUpper}__${precioUnitario ?? "sin_precio"}`;
  let assigned = sillasModeloAssigned.get(key);
  if (assigned === undefined) {
    const next = (sillasModeloCounterPerRazon.get(razonUpper) ?? 0) + 1;
    sillasModeloCounterPerRazon.set(razonUpper, next);
    sillasModeloAssigned.set(key, next);
    assigned = next;
  }
  return `Modelo ${assigned}`;
}

function sillasFinalize(
  marca: string,
  modelo: string,
  razonSocial: string,
  precioUnitario?: number | null
): ParsedBrandModel {
  if (modelo) return { marca, modelo };
  return { marca, modelo: sillasAssignModeloN(razonSocial, precioUnitario) };
}

/**
 * @param sufijoTextRaw  Texto crudo de "SUB ITEMS - SUFIJOS" (puede venir vacio/null).
 * @param razonSocial    Razon social del importador (columna A), tal cual.
 * @param precioUnitario Precio unitario FOB del sub-item, para el paso 9.
 */
function parseMarcaModeloSillasDeRuedasCore(
  sufijoTextRaw: string | null | undefined,
  razonSocial: string,
  precioUnitario?: number | null
): ParsedBrandModel {
  let text = (sufijoTextRaw ?? "").trim();

  // Paso 1: quitar sufijo de aduana "SIN CODIGO (CODIGO)" al final.
  text = text.replace(/\s*SIN\s+CODIGO(\s*\([^)]*\))?\s*$/i, "").trim();

  // Paso 2: comillas, comas y puntos sueltos -> espacio; colapsar espacios.
  text = text
    .replace(/["'.,]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!text) {
    return sillasFinalize(razonSocial, "", razonSocial, precioUnitario);
  }

  // Paso 3: "sin marca" explicito -> Marca = Razon Social completa.
  const sinMarcaMatch = /^(SIN\s+MARCA|S\/MARCA|S\/M)\b\s*(.*)$/i.exec(text);
  if (sinMarcaMatch) {
    const modelo = sinMarcaMatch[2].trim();
    return sillasFinalize(razonSocial, modelo, razonSocial, precioUnitario);
  }

  // Paso 4: corregir typo conocido en la primera palabra.
  let words = text.split(" ").filter(Boolean);
  if (words.length > 0) {
    const firstUpper = words[0].toUpperCase();
    if (SILLAS_TYPO_FIXES[firstUpper]) {
      words[0] = SILLAS_TYPO_FIXES[firstUpper];
      text = words.join(" ");
    }
  }
  const textUpper = text.toUpperCase();

  // Paso 5: diccionario multi-palabra (match mas largo primero).
  for (const [key, canonical] of SILLAS_MULTI_WORD_SORTED) {
    if (textUpper === key || textUpper.startsWith(key + " ")) {
      const modelo = text.slice(key.length).trim();
      return sillasFinalize(canonical, modelo, razonSocial, precioUnitario);
    }
  }

  // Paso 6: marca de una sola palabra ya conocida (tabla OVERRIDE).
  words = text.split(" ").filter(Boolean);
  if (words.length > 0) {
    const firstUpper = words[0].toUpperCase();
    if (SILLAS_SINGLE_WORD_OVERRIDE[firstUpper]) {
      const marca = SILLAS_SINGLE_WORD_OVERRIDE[firstUpper];
      const modelo = words.slice(1).join(" ").trim();
      return sillasFinalize(marca, modelo, razonSocial, precioUnitario);
    }
  }

  // Paso 7: fallback por Razon Social (probar prefijo de 3, 2 o 1 palabras
  // de la razon social sin las palabras vacias societarias).
  const razonWords = razonSocial
    .toUpperCase()
    .split(/\s+/)
    .filter((w) => w && !SILLAS_SOCIETARY_STOPWORDS.has(w));

  for (let take = Math.min(3, razonWords.length); take >= 1; take--) {
    const prefix = razonWords.slice(0, take).join(" ");
    if (prefix.length < 4) continue;
    if (textUpper === prefix || textUpper.startsWith(prefix + " ")) {
      const modelo = text.slice(prefix.length).trim();
      return sillasFinalize(razonSocial, modelo, razonSocial, precioUnitario);
    }
  }

  // Paso 8: fallback generico -> primera palabra como marca (Title Case,
  // o mayusculas si es sigla de <=3 letras), resto como modelo.
  if (words.length === 0) {
    return sillasFinalize(razonSocial, "", razonSocial, precioUnitario);
  }
  const marca = sillasTitleCase(words[0]);
  const modelo = words.slice(1).join(" ").trim();
  return sillasFinalize(marca, modelo, razonSocial, precioUnitario);
}

// ---- Paso 10.1: diccionario de colores (frases de 2 palabras antes que 1) ----
// No se usan palabras en frances (rouge, bleu, etc.) para no confundir con
// modelos reales como "ROGUE"/"ROUGE" de KI Mobility.
const SILLAS_COLOR_DICT: [string, string][] = [
  ["CHARCOAL GREY", "Gris Carbón"],
  ["CHARCOAL GRAY", "Gris Carbón"],
  ["LIGHT GRAY", "Gris Claro"],
  ["LIGHT GREY", "Gris Claro"],
  ["LIGHT GREEN", "Verde Claro"],
  ["LIGHT BLUE", "Celeste"],
  ["DARK BLUE", "Azul Oscuro"],
  ["DARK GREEN", "Verde Oscuro"],
  ["NAVY BLUE", "Azul Marino"],
  ["MATTE BLACK", "Negro"],
  ["MATTE BL", "Negro"],
  ["BLACK", "Negro"],
  ["WHITE", "Blanco"],
  ["BLUE", "Azul"],
  ["RED", "Rojo"],
  ["GREEN", "Verde"],
  ["GREY", "Gris"],
  ["GRAY", "Gris"],
  ["SILVER", "Plata"],
  ["YELLOW", "Amarillo"],
  ["ORANGE", "Naranja"],
  ["PURPLE", "Morado"],
  ["PINK", "Rosa"],
  ["BROWN", "Marrón"],
  ["BEIGE", "Beige"],
  ["GOLD", "Dorado"],
  ["TITANIUM", "Titanio"],
  ["CAMO", "Camuflado"],
  ["NAVY", "Azul Marino"],
  ["NEGRO", "Negro"],
  ["BLANCO", "Blanco"],
  ["AZUL", "Azul"],
  ["ROJO", "Rojo"],
  ["VERDE", "Verde"],
  ["GRIS", "Gris"],
  ["PLATA", "Plata"],
  ["AMARILLO", "Amarillo"],
];
// Match mas largo primero (las frases de 2 palabras antes que las de 1).
const SILLAS_COLOR_SORTED = [...SILLAS_COLOR_DICT].sort((a, b) => b[0].length - a[0].length);

// ---- Paso 10.2: codigos de color "YC" (marca Magesa, series YK90xx) ----
// Tabla aprendida del dataset de referencia (no dinamica): estos codigos
// aparecieron junto a una palabra de color conocida en al menos una fila,
// asi que se puede inferir el color cuando el codigo aparece solo. Un
// codigo YC que no este en esta tabla igual se separa del Modelo (para que
// distintas variantes de color del mismo modelo se unifiquen), solo que el
// Color queda en "Negro" por defecto porque no se conoce el color real.
const SILLAS_YC_CODE_MAP: Record<string, string> = {
  YCB007: "Azul",
  YC104: "Gris Carbón",
  YCR003: "Rojo",
  YC90969: "Plata",
};

const SILLAS_DEFAULT_COLOR = "Negro";

/**
 * Paso 10: separa el color del texto de Modelo (ya limpio, pasos 1-9), para
 * que variantes de color del mismo modelo (ej. "MEWA BLACK" / "MEWA LIGHT
 * GRAY") no queden como modelos distintos. Devuelve el modelo sin el color
 * (si se detecto) y el color canonico (o "Negro" por defecto si no hay
 * informacion de color en el texto).
 */
function sillasExtractColor(modelo: string): { modelo: string; color: string } {
  if (!modelo) return { modelo, color: SILLAS_DEFAULT_COLOR };

  // Paso 10.1: palabra de color conocida al final, con sufijo " YC<codigo>" opcional
  // (algunos registros traen un espacio entre "YC" y el codigo, ej. "YC B007").
  for (const [word, canonical] of SILLAS_COLOR_SORTED) {
    const re = new RegExp(`^(.*?)\\s+${word}(?:\\s+YC\\s*[\\w]+)?$`, "i");
    const m = re.exec(modelo);
    if (m && m[1].trim().length >= 2) {
      return { modelo: m[1].trim(), color: canonical };
    }
  }

  // Paso 10.2: sin palabra de color, pero con codigo "YC<codigo>" al final
  // (tambien tolera espacio entre "YC" y el codigo).
  const ycMatch = /^(.*?)\s+YC\s*([\w]+)$/i.exec(modelo);
  if (ycMatch && ycMatch[1].trim().length >= 2) {
    const code = `YC${ycMatch[2]}`.toUpperCase();
    const known = SILLAS_YC_CODE_MAP[code];
    if (known) {
      return { modelo: ycMatch[1].trim(), color: known };
    }
    // Codigo no aprendido: igual se quita del modelo (para unificar), pero
    // el color queda por defecto porque no sabemos cual es realmente.
    return { modelo: ycMatch[1].trim(), color: SILLAS_DEFAULT_COLOR };
  }

  // Paso 10.3: sin color detectado.
  return { modelo, color: SILLAS_DEFAULT_COLOR };
}

/**
 * @param sufijoTextRaw  Texto crudo de "SUB ITEMS - SUFIJOS" (puede venir vacio/null).
 * @param razonSocial    Razon social del importador (columna A), tal cual.
 * @param precioUnitario Precio unitario FOB del sub-item, para el paso 9.
 */
function parseMarcaModeloSillasDeRuedas(
  sufijoTextRaw: string | null | undefined,
  razonSocial: string,
  precioUnitario?: number | null
): ParsedBrandModel {
  const core = parseMarcaModeloSillasDeRuedasCore(sufijoTextRaw, razonSocial, precioUnitario);
  const { modelo, color } = sillasExtractColor(core.modelo);
  return { marca: core.marca, modelo, color };
}

// ============================================================
// Registro de parsers por categoria
// ============================================================

export const CATEGORY_PARSERS: Record<string, CategoryParser> = {
  // Importante: SIEMPRE se llama al parser, incluso si "sufijos" viene vacio.
  // El parser mismo sabe que hacer en ese caso (usa la Razon Social del
  // importador como Marca).
  sillas_de_ruedas: (raw) => {
    return parseMarcaModeloSillasDeRuedas(raw.sufijos ?? "", raw.nombre ?? "", raw.precio_unitario ?? null);
  },
};

/** Categorias que necesitan el flujo de EXPORTACION (con Sufijos) en vez de /data normal. */
export function categoryUsesExportFlow(categorySlug: string): boolean {
  return categorySlug in CATEGORY_PARSERS;
}
