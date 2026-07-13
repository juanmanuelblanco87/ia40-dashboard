/**
 * Parser Marca / Modelo para la categoria "Sillas de ruedas".
 *
 * Extrae Marca y Modelo desde el texto de aduana de la columna
 * "SUB ITEMS - SUFIJOS" (ej: "TILITE TILITE Z SIN CODIGO (CA00)"). Si no se
 * identifica una marca real, usa la Razon Social del importador como Marca
 * y el codigo/numero ya presente en el texto como Modelo (o "Modelo N"
 * correlativo si no hay ningun codigo distintivo).
 *
 * Cada categoria tendra su propio parser adaptado (ver lib/parsers/index.ts).
 * Este es especifico de sillas de ruedas: diccionarios y reglas de typo
 * fueron armados a partir de los datos reales de esa categoria.
 */

export interface ParsedBrandModel {
  marca: string;
  modelo: string;
}

// ---- Paso 5: diccionario multi-palabra (match mas largo primero) ----
const MULTI_WORD_DICT: [string, string][] = [
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
// match mas largo primero
const MULTI_WORD_SORTED = [...MULTI_WORD_DICT].sort((a, b) => b[0].length - a[0].length);

// ---- Paso 6: marca de una sola palabra (tabla OVERRIDE) ----
const SINGLE_WORD_OVERRIDE: Record<string, string> = {
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
const TYPO_FIXES: Record<string, string> = {
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
const SOCIETARY_STOPWORDS = new Set([
  "S.A.", "SRL", "S.R.L.", "SOCIEDAD", "ANONIMA", "LTDA", "SOC", "RESP",
  "COMERCIAL", "E", "INDUSTRI", "Y", "CIA", "DE", "DEL", "LA", "EL",
  "SUCURSAL", "ARGENTINA", "INDUSTRIAL",
]);

function titleCase(word: string): string {
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
// Si en el futuro hace falta que sea 100% estable entre corridas, hay que
// guardar el contador en una tabla nueva.
const modeloAssigned = new Map<string, number>();
const modeloCounterPerRazon = new Map<string, number>();

function assignModeloN(razonSocial: string, precioUnitario?: number | null): string {
  const razonUpper = razonSocial.toUpperCase();
  const key = `${razonUpper}__${precioUnitario ?? "sin_precio"}`;
  let assigned = modeloAssigned.get(key);
  if (assigned === undefined) {
    const next = (modeloCounterPerRazon.get(razonUpper) ?? 0) + 1;
    modeloCounterPerRazon.set(razonUpper, next);
    modeloAssigned.set(key, next);
    assigned = next;
  }
  return `Modelo ${assigned}`;
}

function finalize(marca: string, modelo: string, razonSocial: string, precioUnitario?: number | null): ParsedBrandModel {
  if (modelo) return { marca, modelo };
  // Paso 9: modelo vacio -> "Modelo N" correlativo
  return { marca, modelo: assignModeloN(razonSocial, precioUnitario) };
}

/**
 * @param sufijoTextRaw  Texto crudo de "SUB ITEMS - SUFIJOS" (puede venir vacio/null).
 * @param razonSocial    Razon social del importador (columna A), tal cual.
 * @param precioUnitario Precio unitario FOB del sub-item (columna "SUB ITEMS - P.U. U$S"), para el paso 9.
 */
export function parseMarcaModeloSillasDeRuedas(
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
    return finalize(razonSocial, "", razonSocial, precioUnitario);
  }

  // Paso 3: "sin marca" explicito -> Marca = Razon Social completa.
  const sinMarcaMatch = /^(SIN\s+MARCA|S\/MARCA|S\/M)\b\s*(.*)$/i.exec(text);
  if (sinMarcaMatch) {
    const modelo = sinMarcaMatch[2].trim();
    return finalize(razonSocial, modelo, razonSocial, precioUnitario);
  }

  // Paso 4: corregir typo conocido en la primera palabra.
  let words = text.split(" ").filter(Boolean);
  if (words.length > 0) {
    const firstUpper = words[0].toUpperCase();
    if (TYPO_FIXES[firstUpper]) {
      words[0] = TYPO_FIXES[firstUpper];
      text = words.join(" ");
    }
  }
  const textUpper = text.toUpperCase();

  // Paso 5: diccionario multi-palabra (match mas largo primero).
  for (const [key, canonical] of MULTI_WORD_SORTED) {
    if (textUpper === key || textUpper.startsWith(key + " ")) {
      const modelo = text.slice(key.length).trim();
      return finalize(canonical, modelo, razonSocial, precioUnitario);
    }
  }

  // Paso 6: marca de una sola palabra ya conocida (tabla OVERRIDE).
  // Se evalua ANTES del fallback por razon social (ver nota de Stryker).
  words = text.split(" ").filter(Boolean);
  if (words.length > 0) {
    const firstUpper = words[0].toUpperCase();
    if (SINGLE_WORD_OVERRIDE[firstUpper]) {
      const marca = SINGLE_WORD_OVERRIDE[firstUpper];
      const modelo = words.slice(1).join(" ").trim();
      return finalize(marca, modelo, razonSocial, precioUnitario);
    }
  }

  // Paso 7: fallback por Razon Social (probar prefijo de 3, 2 o 1 palabras
  // de la razon social sin las palabras vacias societarias).
  const razonWords = razonSocial
    .toUpperCase()
    .split(/\s+/)
    .filter((w) => w && !SOCIETARY_STOPWORDS.has(w));

  for (let take = Math.min(3, razonWords.length); take >= 1; take--) {
    const prefix = razonWords.slice(0, take).join(" ");
    if (prefix.length < 4) continue;
    if (textUpper === prefix || textUpper.startsWith(prefix + " ")) {
      const modelo = text.slice(prefix.length).trim();
      return finalize(razonSocial, modelo, razonSocial, precioUnitario);
    }
  }

  // Paso 8: fallback generico -> primera palabra como marca (Title Case,
  // o mayusculas si es sigla de <=3 letras), resto como modelo.
  if (words.length === 0) {
    return finalize(razonSocial, "", razonSocial, precioUnitario);
  }
  const marca = titleCase(words[0]);
  const modelo = words.slice(1).join(" ").trim();
  return finalize(marca, modelo, razonSocial, precioUnitario);
}
