/**
 * Registro de parsers de marca/modelo/color/segmento por categoria. Cada
 * categoria puede tener su propio parser adaptado (los datos de aduana no
 * son uniformes entre categorias). Si una categoria no tiene parser
 * registrado aca, el sync sigue usando el flujo normal (/data) y la
 * clasificacion manual (provider_brand_map / record_brand_map) como hasta
 * ahora.
 *
 * ARQUITECTURA (actualizada 15/07/2026): el parser de "Sillas de ruedas" se
 * separo en un motor generico reutilizable (createCategoryParser) + una
 * configuracion especifica por categoria. Las 7 categorias nuevas
 * (electricas, andadores, bastones, almohadones, sillas de ducha,
 * elevadores de inodoro, camas hospitalarias) usan el MISMO motor y, salvo
 * que se indique lo contrario, los MISMOS diccionarios de marca y color que
 * ya tenia "Sillas de ruedas" (BRAND_MULTI_WORD_DICT,
 * BRAND_SINGLE_WORD_OVERRIDE, COLOR_DICT): son fabricantes de equipamiento
 * ortopedico/medico (Invacare, Ottobock, Drive Medical, Sunrise Medical,
 * Vermeiren, etc.) y un mismo importador que trae sillas de ruedas
 * tipicamente tambien trae andadores, bastones, camas, etc. de esas mismas
 * marcas, asi que es un punto de partida razonable.
 *
 * MARCA/MODELO/COLOR "DINAMICOS" (sin redeploy): el diccionario estatico de
 * este archivo es solo la primera pasada automatica -- no necesita estar
 * perfecto ni actualizarse cada vez que aparece una marca nueva. Cuando el
 * parser no reconoce algo (por ejemplo al sincronizar un mes nuevo con una
 * marca que nunca se vio), cae en un fallback razonable (Paso 7/8 abajo) y
 * el sync NUNCA falla por esto. La correccion real, "para siempre", se hace
 * desde la pantalla /admin (tablas provider_brand_map / record_brand_map,
 * que ya incluyen marca+modelo+color) sin tocar codigo ni redesplegar: el
 * fix queda guardado en la base y se re-aplica automaticamente en cada
 * /api/sync futuro para ese importador (ver lib/aggregate.ts). Estan
 * generalizadas a las 8 categorias, asi que ya funcionan para las 7
 * categorias nuevas sin cambios adicionales.
 *
 * Lo que NO se reutiliza tal cual es la clasificacion de Segmento: los 6
 * segmentos de sillas de ruedas ("Silla Ultra Livianas", "Silla Activa y
 * Deportivas", etc.) son un criterio propio armado mirando datos reales de
 * ESA categoria especifica, y no tiene sentido aplicarselo a, por ejemplo,
 * "andadores". Para las 6 categorias nuevas no-electricas, y para "Sillas
 * de Ruedas Electricas" (que tampoco reutiliza el esquema de sillas
 * manuales: son ejes de clasificacion distintos), se armo una taxonomia de
 * Segmento propia por categoria (validada con el usuario 15/07/2026, ver
 * docs/ncm_nuevas_categorias.md), implementada como `segmentoKeywords`:
 * palabra clave detectada en el texto de Modelo -> segmento. CONFIANZA BAJA:
 * son keywords tipicas en ingles/espanol de fichas de producto, todavia no
 * verificadas contra datos reales de IA40 de estas categorias -- hay que
 * revisarlas/completarlas con el primer sync real de cada una (mirar que
 * texto de Modelo esta quedando sin clasificar en el fallback y agregar la
 * keyword que corresponda), igual que se hizo en su momento para sillas de
 * ruedas.
 *
 * NOTA: todo vive en este mismo archivo (no en archivos separados por
 * categoria) a proposito, para evitar un import relativo entre archivos que
 * en este proyecto no se pudo resolver de forma consistente en Vercel (el
 * archivo lib/parsers/sillasDeRuedas.ts existia y tenia el contenido
 * correcto, pero el build fallaba igual con "Module not found").
 */

export interface ParsedBrandModel {
  marca: string;
  modelo: string;
  color?: string;
  segmento?: string;
}

export type CategoryParser = (raw: Record<string, any>) => ParsedBrandModel | null;

// ============================================================
// Diccionarios COMPARTIDOS de marca y color (armados originalmente
// analizando datos reales de "Sillas de ruedas" -- para las categorias
// nuevas son un punto de partida razonable, pero conviene revisarlos con
// los datos reales de cada categoria una vez sincronizada).
// ============================================================

// ---- diccionario multi-palabra (match mas largo primero) ----
const BRAND_MULTI_WORD_DICT: [string, string][] = [
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

// ---- marca de una sola palabra (tabla OVERRIDE) ----
const BRAND_SINGLE_WORD_OVERRIDE: Record<string, string> = {
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

// ---- typos conocidos (primera palabra) ----
const BRAND_TYPO_FIXES: Record<string, string> = {
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

// ---- palabras vacias societarias ----
const SOCIETARY_STOPWORDS = new Set([
  "S.A.", "SRL", "S.R.L.", "SOCIEDAD", "ANONIMA", "LTDA", "SOC", "RESP",
  "COMERCIAL", "E", "INDUSTRI", "Y", "CIA", "DE", "DEL", "LA", "EL",
  "SUCURSAL", "ARGENTINA", "INDUSTRIAL",
]);

// ---- diccionario de colores (frases de 2 palabras antes que 1) ----
// No se usan palabras en frances (rouge, bleu, etc.) para no confundir con
// modelos reales como "ROGUE"/"ROUGE" de KI Mobility.
const COLOR_DICT: [string, string][] = [
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

// ---- codigos de color "YC" (marca Magesa, series YK90xx) ----
const SILLAS_YC_CODE_MAP: Record<string, string> = {
  YCB007: "Azul",
  YC104: "Gris Carbón",
  YCR003: "Rojo",
  YC90969: "Plata",
};

const DEFAULT_COLOR = "Negro";

function titleCase(word: string): string {
  if (word.length <= 3) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// ============================================================
// Motor generico de parseo (fabrica de parsers por categoria)
// ============================================================

interface CategoryParserConfig {
  multiWordDict?: [string, string][];
  singleWordOverride?: Record<string, string>;
  typoFixes?: Record<string, string>;
  societaryStopwords?: Set<string>;
  colorDict?: [string, string][];
  ycCodeMap?: Record<string, string>;
  defaultColor?: string;
  segmentoKeywords?: [string, string][];
  segmentoBrandPrefix?: [string, string, string][];
  segmentoBrandDefault?: Record<string, string>;
  segmentoFallback: string;
}

function createCategoryParser(config: CategoryParserConfig): CategoryParser {
  const multiWordSorted = [...(config.multiWordDict ?? BRAND_MULTI_WORD_DICT)].sort(
    (a, b) => b[0].length - a[0].length
  );
  const singleWordOverride = config.singleWordOverride ?? BRAND_SINGLE_WORD_OVERRIDE;
  const typoFixes = config.typoFixes ?? BRAND_TYPO_FIXES;
  const stopwords = config.societaryStopwords ?? SOCIETARY_STOPWORDS;
  const colorSorted = [...(config.colorDict ?? COLOR_DICT)].sort((a, b) => b[0].length - a[0].length);
  const ycCodeMap = config.ycCodeMap ?? {};
  const defaultColor = config.defaultColor ?? DEFAULT_COLOR;

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

  function finalize(
    marca: string,
    modelo: string,
    razonSocial: string,
    precioUnitario?: number | null
  ): { marca: string; modelo: string } {
    if (modelo) return { marca, modelo };
    return { marca, modelo: assignModeloN(razonSocial, precioUnitario) };
  }

  function parseCore(
    sufijoTextRaw: string | null | undefined,
    razonSocial: string,
    precioUnitario?: number | null
  ): { marca: string; modelo: string } {
    let text = (sufijoTextRaw ?? "").trim();

    text = text.replace(/\s*SIN\s+CODIGO(\s*\([^)]*\))?\s*$/i, "").trim();

    text = text
      .replace(/["'.,]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!text) {
      return finalize(razonSocial, "", razonSocial, precioUnitario);
    }

    const sinMarcaMatch = /^(SIN\s+MARCA|S\/MARCA|S\/M)\b\s*(.*)$/i.exec(text);
    if (sinMarcaMatch) {
      const modelo = sinMarcaMatch[2].trim();
      return finalize(razonSocial, modelo, razonSocial, precioUnitario);
    }

    let words = text.split(" ").filter(Boolean);
    if (words.length > 0) {
      const firstUpper = words[0].toUpperCase();
      if (typoFixes[firstUpper]) {
        words[0] = typoFixes[firstUpper];
        text = words.join(" ");
      }
    }
    const textUpper = text.toUpperCase();

    for (const [key, canonical] of multiWordSorted) {
      if (textUpper === key || textUpper.startsWith(key + " ")) {
        const modelo = text.slice(key.length).trim();
        return finalize(canonical, modelo, razonSocial, precioUnitario);
      }
    }

    words = text.split(" ").filter(Boolean);
    if (words.length > 0) {
      const firstUpper = words[0].toUpperCase();
      if (singleWordOverride[firstUpper]) {
        const marca = singleWordOverride[firstUpper];
        const modelo = words.slice(1).join(" ").trim();
        return finalize(marca, modelo, razonSocial, precioUnitario);
      }
    }

    const razonWords = razonSocial
      .toUpperCase()
      .split(/\s+/)
      .filter((w) => w && !stopwords.has(w));

    for (let take = Math.min(3, razonWords.length); take >= 1; take--) {
      const prefix = razonWords.slice(0, take).join(" ");
      if (prefix.length < 4) continue;
      if (textUpper === prefix || textUpper.startsWith(prefix + " ")) {
        const modelo = text.slice(prefix.length).trim();
        return finalize(razonSocial, modelo, razonSocial, precioUnitario);
      }
    }

    if (words.length === 0) {
      return finalize(razonSocial, "", razonSocial, precioUnitario);
    }
    const marca = titleCase(words[0]);
    const modelo = words.slice(1).join(" ").trim();
    return finalize(marca, modelo, razonSocial, precioUnitario);
  }

  function extractColor(modelo: string): { modelo: string; color: string } {
    if (!modelo) return { modelo, color: defaultColor };

    for (const [word, canonical] of colorSorted) {
      const re = new RegExp(`^(.*?)\\s+${word}(?:\\s+YC\\s*[\\w]+)?$`, "i");
      const m = re.exec(modelo);
      if (m && m[1].trim().length >= 2) {
        return { modelo: m[1].trim(), color: canonical };
      }
    }

    const ycMatch = /^(.*?)\s+YC\s*([\w]+)$/i.exec(modelo);
    if (ycMatch && ycMatch[1].trim().length >= 2) {
      const code = `YC${ycMatch[2]}`.toUpperCase();
      const known = ycCodeMap[code];
      if (known) {
        return { modelo: ycMatch[1].trim(), color: known };
      }
      return { modelo: ycMatch[1].trim(), color: defaultColor };
    }

    return { modelo, color: defaultColor };
  }

  function assignSegmento(marca: string, modelo: string): string {
    const modeloUpper = (modelo || "").toUpperCase();

    for (const [keyword, segmento] of config.segmentoKeywords ?? []) {
      if (modeloUpper.includes(keyword)) return segmento;
    }

    for (const [m, prefix, segmento] of config.segmentoBrandPrefix ?? []) {
      if (marca === m && modeloUpper.includes(prefix)) return segmento;
    }

    if (config.segmentoBrandDefault?.[marca]) return config.segmentoBrandDefault[marca];

    return config.segmentoFallback;
  }

  return (raw) => {
    const core = parseCore(raw.sufijos ?? "", raw.nombre ?? "", raw.precio_unitario ?? null);
    const { modelo, color } = extractColor(core.modelo);
    const segmento = assignSegmento(core.marca, modelo);
    return { marca: core.marca, modelo, color, segmento };
  };
}

// ============================================================
// Config: Sillas de ruedas -- Segmento propio (6 valores, armados
// analizando datos reales de esta categoria especificamente).
// ============================================================

const SEGMENTO_KEYWORDS: [string, string][] = [
  ["KID", "Sillas Infantiles"],
  ["JUNIOR", "Sillas Infantiles"],
  ["NINOS", "Sillas Infantiles"],
  ["NIÑOS", "Sillas Infantiles"],
  ["PEDIATRI", "Sillas Infantiles"],
  ["INFANT", "Sillas Infantiles"],
  ["BUGGY", "Sillas Infantiles"],
  ["STROLLER", "Sillas Infantiles"],
  ["TEEN", "Sillas Infantiles"],
  ["RUGBY", "Silla Activa y Deportivas"],
  ["BASKETBALL", "Silla Activa y Deportivas"],
  ["BASQUET", "Silla Activa y Deportivas"],
  ["TENNIS", "Silla Activa y Deportivas"],
  ["BADMINTON", "Silla Activa y Deportivas"],
  ["HANDBALL", "Silla Activa y Deportivas"],
  ["SPORT", "Silla Activa y Deportivas"],
  ["STANDER", "Silla Postural"],
  ["TILT", "Silla Postural"],
  ["RECLIN", "Silla Postural"],
  ["INODORO", "Silla de Traslado"],
];

const SEGMENTO_BRAND_PREFIX: [string, string, string][] = [
  ["Sunrise Medical", "ZIPPIE", "Sillas Infantiles"],
  ["Sunrise Medical", "QUICKIE IRIS", "Sillas Infantiles"],
  ["Sunrise Medical", "QUICKIE NITRUM", "Silla Ultra Livianas"],
  ["Sunrise Medical", "QUICKIE XENON", "Silla Ultra Livianas"],
  ["Sunrise Medical", "XENON", "Silla Ultra Livianas"],
  ["Sunrise Medical", "QUICKIE QRI", "Silla Ultra Livianas"],
  ["Sunrise Medical", "QUICKIE 5R", "Silla Ultra Livianas"],
  ["Sunrise Medical", "QUICKIE M6", "Silla Ultra Livianas"],
  ["Sunrise Medical", "QUICKIE GP", "Silla Ultra Livianas"],
  ["Sunrise Medical", "NITRUM", "Silla Ultra Livianas"],
  ["Sunrise Medical", "KRYPTON", "Silla Ultra Livianas"],
  ["Sunrise Medical", "OCTANE", "Silla Activa y Deportivas"],
  ["Sunrise Medical", "GRAND SLAM", "Silla Activa y Deportivas"],
  ["Sunrise Medical", "RGK", "Silla Activa y Deportivas"],
  ["KI Mobility", "LITTLE WAVE", "Sillas Infantiles"],
  ["KI Mobility", "FOCUS CR", "Sillas Infantiles"],
  ["KI Mobility", "SPARK", "Sillas Infantiles"],
  ["KI Mobility", "ROGUE", "Silla Ultra Livianas"],
  ["KI Mobility", "ROUGE", "Silla Ultra Livianas"],
  ["KI Mobility", "CATALYST", "Silla Ultra Livianas"],
  ["KI Mobility", "LIBERTY", "Silla Ultra Livianas"],
  ["KI Mobility", "ETHOS", "Silla Ultra Livianas"],
  ["Ottobock", "KIMBA", "Sillas Infantiles"],
  ["Ottobock", "ECO BUGGY", "Sillas Infantiles"],
  ["Ottobock", "LISA REHAB", "Sillas Infantiles"],
  ["Ottobock", "VENTUS", "Silla Postural"],
  ["Ottobock", "MOTUS", "Silla Postural"],
  ["Ottobock", "ZENIT", "Silla Postural"],
  ["Ottobock", "AVANTGARDE", "Silla Postural"],
  ["Invacare", "CLEMATISPRO", "Silla Postural"],
  ["Invacare", "LEMATISPRO", "Silla Postural"],
  ["Invacare", "PRO CG", "Silla Postural"],
  ["Invacare", "REA AZALEA", "Sillas Infantiles"],
  ["Invacare", "KSL", "Silla Ultra Livianas"],
  ["Vermeiren", "SAGITTA KIDS", "Sillas Infantiles"],
  ["Vermeiren", "SAGITTA", "Silla Postural"],
  ["Vermeiren", "INOVYS", "Silla Postural"],
  ["Meyra", "FEMTO", "Silla Ultra Livianas"],
  ["Meyra", "NANO", "Sillas Infantiles"],
  ["Jiangsu Intco Medica", "COYOTE", "Sillas Infantiles"],
  ["Alu Rehab", "COYOTE", "Silla Postural"],
];

const SEGMENTO_BRAND_DEFAULT: Record<string, string> = {
  "A&J": "Silla Estándar",
  "Achieve": "Silla Activa y Deportivas",
  "Akces Med": "Silla Postural",
  "Alu Rehab": "Silla Postural",
  "Amelife": "Silla Estándar",
  "Anatomic": "Silla Postural",
  "Antares": "Silla Estándar",
  "Aria": "Silla Ultra Livianas",
  "Aspen": "Silla Estándar",
  "Berollka": "Silla Activa y Deportivas",
  "Box Wheelchairs": "Silla Activa y Deportivas",
  "Care Quip": "Silla Estándar",
  "Circle Specialty": "Sillas Infantiles",
  "Comfort": "Sillas Infantiles",
  "Convaid Products LLC": "Sillas Infantiles",
  "Double Care Medical": "Silla Estándar",
  "Drive Medical": "Silla Estándar",
  "EuroMix": "Silla Estándar",
  "Extra": "Silla Activa y Deportivas",
  "FARMACIA DE MEDRANO 533 SOCIED": "Silla Estándar",
  "Foshan": "Silla Estándar",
  "Foshan Dongfang": "Silla Estándar",
  "Foshan Dongfang Medical": "Silla Estándar",
  "Foshan Dongfang Medical Equipment Manufactory Ltd": "Silla Estándar",
  "Foshan Ecarre Medica": "Silla Estándar",
  "Foshan Feiyang": "Silla Estándar",
  "Foshan Gege": "Silla Estándar",
  "Foshan Kaiyang": "Silla Estándar",
  "Foshan Rafu Medical": "Silla Estándar",
  "Future Mobility Healthcare": "Silla Postural",
  "Gigantex": "Silla Estándar",
  "Guangdong Kaiyang": "Silla Estándar",
  "Hoggi": "Sillas Infantiles",
  "Intco": "Silla Estándar",
  "Intco Medical Industries Inc": "Silla Estándar",
  "Invacare": "Silla Estándar",
  "JEPOINT S. A.": "Silla Estándar",
  "James Leckey Design": "Sillas Infantiles",
  "Jiangsu": "Silla Estándar",
  "Jiangsu Intco Medica": "Silla Estándar",
  "Jiangsu Rixin Medica": "Silla Estándar",
  "Jianlian": "Silla Estándar",
  "KDB": "Silla Estándar",
  "KI Mobility": "Silla Ultra Livianas",
  "Kaiyang Medical": "Silla Estándar",
  "Karma": "Silla Estándar",
  "LIW": "Sillas Infantiles",
  "LIW Care Technology": "Sillas Infantiles",
  "Leggero": "Sillas Infantiles",
  "Lerado": "Silla Estándar",
  "LifeCare": "Silla Estándar",
  "Lightning": "Silla Postural",
  "MDH SP Z.O.O.": "Sillas Infantiles",
  "Magesa": "Silla Estándar",
  "Maverick": "Silla Estándar",
  "Merits": "Silla Estándar",
  "Meyra": "Silla Estándar",
  "Motion Composites": "Silla Ultra Livianas",
  "Movicare": "Silla Estándar",
  "Mugi": "Silla Estándar",
  "MyWam": "Sillas Infantiles",
  "NeaTech": "Sillas Infantiles",
  "Nova": "Silla de Traslado",
  "Offcarr": "Silla Postural",
  "One": "Sillas Infantiles",
  "Ormesa": "Sillas Infantiles",
  "Ortobras": "Silla Estándar",
  "Ottobock": "Silla Estándar",
  "PDG Product Design": "Silla Postural",
  "Patron": "Silla Postural",
  "Polior": "Silla Estándar",
  "R82": "Sillas Infantiles",
  "RGK": "Silla Activa y Deportivas",
  "Rebotec": "Silla Ultra Livianas",
  "Rifton": "Sillas Infantiles",
  "Sarl Vipamat": "Silla Activa y Deportivas",
  "SitMed": "Silla Postural",
  "Stealth Products": "Silla Postural",
  "Stryker": "Silla de Traslado",
  "SunCare": "Silla Estándar",
  "Sunrise Medical": "Silla Estándar",
  "TENACTA SOCIEDAD ANONIMA": "Silla Estándar",
  "TRINIDAD INSUMOS S.R.L.": "Silla Estándar",
  "Thomashilfen": "Sillas Infantiles",
  "TiLite": "Silla Ultra Livianas",
  "Timo": "Silla Postural",
  "Top Medi": "Silla Estándar",
  "U Nurse": "Silla Estándar",
  "Vermeiren": "Silla Estándar",
  "Vesco": "Silla Activa y Deportivas",
  "Water": "Silla de Traslado",
  "Yuwell": "Silla Estándar",
};

const SILLAS_SEGMENTO_FALLBACK = "Silla Estándar";

const sillasDeRuedasParser = createCategoryParser({
  ycCodeMap: SILLAS_YC_CODE_MAP,
  segmentoKeywords: SEGMENTO_KEYWORDS,
  segmentoBrandPrefix: SEGMENTO_BRAND_PREFIX,
  segmentoBrandDefault: SEGMENTO_BRAND_DEFAULT,
  segmentoFallback: SILLAS_SEGMENTO_FALLBACK,
});

const ELECTRICAS_SEGMENTO_KEYWORDS: [string, string][] = [
  ["BARIATRIC", "Bariátrica"],
  ["BARIATRICA", "Bariátrica"],
  ["RECLIN", "Reclinable"],
  ["FOLDING", "Plegable"],
  ["FOLDABLE", "Plegable"],
  ["PLEGABLE", "Plegable"],
  ["ALL TERRAIN", "Todo Terreno/Exterior"],
  ["ALL-TERRAIN", "Todo Terreno/Exterior"],
  ["OUTDOOR", "Todo Terreno/Exterior"],
  ["RUGGED", "Todo Terreno/Exterior"],
  ["TODO TERRENO", "Todo Terreno/Exterior"],
  ["INDOOR", "Interior/Compacta"],
  ["COMPACT", "Interior/Compacta"],
  ["COMPACTA", "Interior/Compacta"],
];

const sillasRuedasElectricasParser = createCategoryParser({
  segmentoKeywords: ELECTRICAS_SEGMENTO_KEYWORDS,
  segmentoFallback: "Silla Eléctrica Estándar",
});

// ---- Andadores y Bastones ----
// NOTA (16/07/2026): estas dos categorias YA NO usan createCategoryParser
// ni un NCM propio. Se descubrio que el NCM que se les habia asignado
// (9021.10.10) en realidad agrupa 5 sub-posiciones de aduana muy distintas
// (cuello, columna, calzado, muletas/bastones, residual) y que ademas el
// sufijo "LOS DEMAS" sigue mezclando productos no relacionados. El usuario
// armo un criterio de clasificacion por marca + descripcion de posicion
// (ver seccion "PARSER NCM 9021.10.10 -- ORTOPEDIA / ODONTOLOGIA" mas abajo
// en este archivo) que reemplaza el parser/segmento propio que tenian
// antes. Ver `parseOrtopedia9021Row` y `ORTOPEDIA_9021_CATEGORY_SLUGS`.

// ---- Almohadones Ortopedicos ----
const ALMOHADONES_SEGMENTO_KEYWORDS: [string, string][] = [
  ["VISCO", "Cojín Viscoelástico"],
  ["MEMORY FOAM", "Cojín Viscoelástico"],
  ["MEMORIA", "Cojín Viscoelástico"],
  ["GEL", "Cojín de Gel/Silicona"],
  ["SILICONE", "Cojín de Gel/Silicona"],
  ["SILICONA", "Cojín de Gel/Silicona"],
  ["AIR CELL", "Cojín de Aire"],
  ["INFLATABLE", "Cojín de Aire"],
  ["AIRE", "Cojín de Aire"],
  ["HYBRID", "Cojín Mixto"],
  ["COMBO", "Cojín Mixto"],
  ["MIXTO", "Cojín Mixto"],
];
const almohadonesOrtopedicosParser = createCategoryParser({
  segmentoKeywords: ALMOHADONES_SEGMENTO_KEYWORDS,
  segmentoFallback: "Almohadón Estándar",
});

// ---- Sillas de Ducha ----
const SILLAS_DUCHA_SEGMENTO_KEYWORDS: [string, string][] = [
  ["SELF PROPEL", "Silla Autopropulsable"],
  ["AUTOPROPULS", "Silla Autopropulsable"],
  ["RECLIN", "Silla Reclinable"],
  ["WHEEL", "Silla con Ruedas (Traslado)"],
  ["RUEDAS", "Silla con Ruedas (Traslado)"],
  ["FOLDING", "Silla Fija/Plegable"],
  ["PLEGABLE", "Silla Fija/Plegable"],
  ["FIXED", "Silla Fija/Plegable"],
];
const sillasDuchaParser = createCategoryParser({
  segmentoKeywords: SILLAS_DUCHA_SEGMENTO_KEYWORDS,
  segmentoFallback: "Silla de Ducha Estándar",
});

// ---- Elevadores de Inodoro ----
const ELEVADORES_SEGMENTO_KEYWORDS: [string, string][] = [
  ["ARMREST", "Elevador con Apoyabrazos"],
  ["APOYABRAZOS", "Elevador con Apoyabrazos"],
  ["REPOSABRAZOS", "Elevador con Apoyabrazos"],
  ["BACKREST", "Elevador con Respaldo"],
  ["RESPALDO", "Elevador con Respaldo"],
];
const elevadoresInodoroParser = createCategoryParser({
  segmentoKeywords: ELEVADORES_SEGMENTO_KEYWORDS,
  segmentoFallback: "Elevador Simple",
});

// ---- Camas Hospitalarias ----
const CAMAS_SEGMENTO_KEYWORDS: [string, string][] = [
  ["BARIATRIC", "Cama Bariátrica"],
  ["BARIATRICA", "Cama Bariátrica"],
  ["PEDIATRIC", "Cama Pediátrica"],
  ["PEDIATRICA", "Cama Pediátrica"],
  ["SEMI ELECTRIC", "Cama Semi-Eléctrica"],
  ["SEMI-ELECTRIC", "Cama Semi-Eléctrica"],
  ["SEMIELECTRICA", "Cama Semi-Eléctrica"],
  ["ELECTRIC", "Cama Eléctrica"],
  ["ELECTRICA", "Cama Eléctrica"],
  ["MANUAL", "Cama Manual"],
];
const camasHospitalariasParser = createCategoryParser({
  segmentoKeywords: CAMAS_SEGMENTO_KEYWORDS,
  segmentoFallback: "Cama Estándar",
});

// ============================================================
// Registro de parsers por categoria
// ============================================================

export const CATEGORY_PARSERS: Record<string, CategoryParser> = {
  // NOTA: "andadores", "bastones" y "calzado_ortopedico" NO estan aca --
  // usan el parser especial de NCM 9021.10.10 (parseOrtopedia9021Row, mas
  // abajo), que se invoca directo desde app/api/sync/route.ts en vez de a
  // traves de este registro (porque un solo NCM se reparte en 3 categorias
  // segun marca/descripcion, no es 1 categoria = 1 parser).
  sillas_de_ruedas: sillasDeRuedasParser,
  sillas_ruedas_electricas: sillasRuedasElectricasParser,
  almohadones_ortopedicos: almohadonesOrtopedicosParser,
  sillas_ducha: sillasDuchaParser,
  elevadores_inodoro: elevadoresInodoroParser,
  camas_hospitalarias: camasHospitalariasParser,
};

/** Categorias que necesitan el flujo de EXPORTACION (con Sufijos) en vez de /data normal. */
export function categoryUsesExportFlow(categorySlug: string): boolean {
  return categorySlug in CATEGORY_PARSERS || ORTOPEDIA_9021_CATEGORY_SLUGS.includes(categorySlug as any);
}

// ============================================================
// PARSER NCM 9021.10.10 — ORTOPEDIA / ODONTOLOGIA (16/07/2026)
// ============================================================
export const ORTOPEDIA_9021_NCM = "9021.10.10";
export const ORTOPEDIA_9021_CATEGORY_SLUGS = ["andadores", "bastones", "calzado_ortopedico"] as const;

export interface OrtopediaParsed {
  marca: string;
  modelo: string;
  color: string;
  segmento: string;
  categoriaSlug: "andadores" | "bastones" | "calzado_ortopedico" | null;
}

type OrtopediaCategoria =
  | "Ortodoncia"
  | "Ortopedia y Protesis"
  | "Implantes de Columna"
  | "Implantes de Trauma y Cirugia"
  | "Inmovilizadores y Ferulas"
  | "Ayudas para la Marcha"
  | "Bipedestacion y Rehab. Pediatrica"
  | "Calzado Ortopedico"
  | "Otros";

const ORTOPEDIA_MARCA_TABLE: [string, OrtopediaCategoria, string][] = [
  ["ADITEK", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["MORELLI", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["ASTAR", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["AMERICAN ORTHODONTICS", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["GC", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["TECNIDENT", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["ORTHO ORGANIZERS", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["ORTHOMETRIC", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["MODERN ORTHODONTICS", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["LM-DENTAL", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["LM DENTAL", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["HUBIT", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["WORLD CLASS TECHNOLOGY", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["EKSEN", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["DTC", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["G&H ORTHODONTICS", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["DENTAURUM", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["FORESTADENT", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["LEONE", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["ORTHO TECHNOLOGY", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["DYNAFLEX", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["TDM", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["DENSELL", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["SHINYE", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["AOSUO", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["RAISE", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["VOYAR", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["FROGGY MOUTH", "Ortodoncia", "Insumos y Aparatologia de Ortodoncia"],
  ["CLEARCORRECT", "Ortodoncia", "Alineadores Transparentes"],
  ["ALIGN TECHNOLOGY", "Ortodoncia", "Alineadores Transparentes"],
  ["SPARK (ORMCO)", "Ortodoncia", "Alineadores Transparentes"],

  ["OSSUR", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["ÖSSUR", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["OTTOBOCK", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["FILLAUER", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["ALPS", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["STREIFENEDER", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["PROTEOR", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["STEEPER", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["TOUCH BIONICS", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["PECLAB", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["IMD", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["PER ROS", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["AMBROISE", "Ortopedia y Protesis", "Protesis de Miembro"],
  ["BECKER ORTHOPEDIC", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["FIOR & GENTZ", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["FIOR GENTZ", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["ALLARD", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["TURBOMED", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["CAMP SCANDINAVIA", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["SYMMETRIC DESIGNS", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["SPIO", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["DESIGN VERONIQUE", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["REHANORM", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["VELA", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["VOE", "Ortopedia y Protesis", "Ortesis de Miembro"],
  ["ANJON", "Ortopedia y Protesis", "Ortesis de Miembro"],

  ["ULRICH MEDICAL", "Implantes de Columna", "Sistemas de Fijacion Vertebral"],
  ["CANWELL", "Implantes de Columna", "Sistemas de Fijacion Vertebral"],
  ["PETER LAZIC", "Implantes de Columna", "Sistemas de Fijacion Vertebral"],
  ["ARTUS", "Implantes de Columna", "Sistemas de Fijacion Vertebral"],
  ["MEDTRONIC", "Implantes de Columna", "Sistemas de Fijacion Vertebral"],
  ["JAZZ LOCK", "Implantes de Columna", "Sistemas de Fijacion Vertebral"],
  ["CDH", "Implantes de Columna", "Sistemas de Fijacion Vertebral"],
  ["CENTINEL SPINE", "Implantes de Columna", "Dispositivos Intersomaticos"],
  ["SILONY SPINE", "Implantes de Columna", "Dispositivos Intersomaticos"],
  ["TRIADYME", "Implantes de Columna", "Dispositivos Intersomaticos"],

  ["ARTHREX", "Implantes de Trauma y Cirugia", "Artroscopia y Medicina Deportiva"],
  ["JIANGSU SHUANGYANG", "Implantes de Trauma y Cirugia", "Trauma y Osteosintesis"],
  ["JIANGSU", "Implantes de Trauma y Cirugia", "Trauma y Osteosintesis"],
  ["WONDERFU", "Implantes de Trauma y Cirugia", "Trauma y Osteosintesis"],
  ["CALDERA MEDICAL", "Implantes de Trauma y Cirugia", "Trauma y Osteosintesis"],
  ["CIZETA SURGICAL", "Implantes de Trauma y Cirugia", "Trauma y Osteosintesis"],
  ["TECRES", "Implantes de Trauma y Cirugia", "Trauma y Osteosintesis"],
  ["KLS MARTIN", "Implantes de Trauma y Cirugia", "Cirugia Maxilofacial"],

  ["ASPEN", "Inmovilizadores y Ferulas", "Ortesis de Columna y Lumbar"],
  ["BAXMAX", "Inmovilizadores y Ferulas", "Ortesis de Columna y Lumbar"],
  ["BODY CARE", "Inmovilizadores y Ferulas", "Ortesis de Columna y Lumbar"],
  ["DONJOY", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["AIRCAST", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["DJO", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["PROCARE", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["REH4MAT", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["STABILO", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["ANTARES", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["THERAMART", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["EMERALD SUPPLY", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["BLISS MEDICAL", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["MEDLINE", "Inmovilizadores y Ferulas", "Inmovilizadores y Ferulas de Miembro"],
  ["AMELIFE", "Inmovilizadores y Ferulas", "Collares Cervicales"],
  ["MEDRESQ", "Inmovilizadores y Ferulas", "Collares Cervicales"],
  ["XIEHE MEDICAL", "Inmovilizadores y Ferulas", "Collares Cervicales"],
  ["TINGEER", "Inmovilizadores y Ferulas", "Collares Cervicales"],
  ["IRON DUCK", "Inmovilizadores y Ferulas", "Collares Cervicales"],

  ["MAVERICK", "Ayudas para la Marcha", "Muletas y Bastones"],
  ["SUNCARE", "Ayudas para la Marcha", "Muletas y Bastones"],
  ["MAGESA", "Ayudas para la Marcha", "Muletas y Bastones"],
  ["ACHIEVE", "Ayudas para la Marcha", "Muletas y Bastones"],
  ["SAN UP", "Ayudas para la Marcha", "Muletas y Bastones"],
  ["SILFAB", "Ayudas para la Marcha", "Muletas y Bastones"],
  ["VOLARIS", "Ayudas para la Marcha", "Andadores y Ayudas de Marcha"],
  ["JIANLIAN", "Ayudas para la Marcha", "(segun descripcion)"],
  ["DRIVE MEDICAL", "Ayudas para la Marcha", "(segun descripcion)"],
  ["REBOTEC", "Ayudas para la Marcha", "(segun descripcion)"],
  ["LIFECARE", "Ayudas para la Marcha", "(segun descripcion)"],
  ["KAIYANG MEDICAL", "Ayudas para la Marcha", "(segun descripcion)"],
  ["INTCO", "Ayudas para la Marcha", "(segun descripcion)"],
  ["JIANGSU INTCO MEDICAL", "Ayudas para la Marcha", "(segun descripcion)"],
  ["MPSHOP", "Ayudas para la Marcha", "(segun descripcion)"],
  ["YUWELL", "Ayudas para la Marcha", "(segun descripcion)"],
  ["MUGI", "Ayudas para la Marcha", "(segun descripcion)"],
  ["MOVICARE", "Ayudas para la Marcha", "(segun descripcion)"],
  ["VERMEIREN", "Ayudas para la Marcha", "(segun descripcion)"],
  ["SUNRISE MEDICAL", "Ayudas para la Marcha", "(segun descripcion)"],
  ["WATER", "Ayudas para la Marcha", "(segun descripcion)"],
  ["U NURSE", "Ayudas para la Marcha", "(segun descripcion)"],
  ["A&J", "Ayudas para la Marcha", "(segun descripcion)"],
  ["DONGGUAN LEYUAN", "Ayudas para la Marcha", "(segun descripcion)"],
  ["DOUBLE CARE MEDICAL", "Ayudas para la Marcha", "(segun descripcion)"],
  ["JIANWEI", "Ayudas para la Marcha", "(segun descripcion)"],
  ["FOSHAN", "Ayudas para la Marcha", "(segun descripcion)"],
  ["FOSHAN GEGE", "Ayudas para la Marcha", "(segun descripcion)"],
  ["FOSHAN KAIYANG", "Ayudas para la Marcha", "(segun descripcion)"],
  ["FOSHAN RAFU MEDICAL", "Ayudas para la Marcha", "(segun descripcion)"],
  ["FOSHAN ECARRE MEDICAL", "Ayudas para la Marcha", "(segun descripcion)"],
  ["FOSHAN DONGFANG MEDICAL", "Ayudas para la Marcha", "(segun descripcion)"],

  ["EASYSTAND", "Bipedestacion y Rehab. Pediatrica", "Bipedestadores"],
  ["R82", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["RIFTON", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["AKCES MED", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["ORMESA", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["JENX", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["LIW CARE TECHNOLOGY", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["HOGGI", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["CIRCLE SPECIALTY", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["BEROLLKA", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["MYWAM", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["NEXTSTEP ROBOTICS", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["USL ROBOTICS", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],
  ["AUXIVO", "Bipedestacion y Rehab. Pediatrica", "Equipamiento de Rehabilitacion Pediatrica"],

  ["MEMO", "Calzado Ortopedico", "Calzado Ortopedico"],
  ["MD ORTHOPAEDICS", "Calzado Ortopedico", "Calzado Ortopedico"],
  ["BILLY FOOTWEAR", "Calzado Ortopedico", "Calzado Ortopedico"],
  ["STEP ON", "Calzado Ortopedico", "Calzado Ortopedico"],

  ["TRINIDAD INSUMOS S.R.L.", "Otros", "Otros"],
  ["TRINIDAD INSUMOS", "Otros", "Otros"],
  ["IOWA", "Otros", "Otros"],
  ["OTOSTICK", "Otros", "Otros"],
  ["DQM VETERINARIA", "Otros", "Otros"],
  ["GE RUI HONG KANG", "Otros", "Otros"],
];

const ORTOPEDIA_MARCA_DICT: Record<string, { categoria: OrtopediaCategoria; segmento: string }> = Object.fromEntries(
  ORTOPEDIA_MARCA_TABLE.map(([marca, categoria, segmento]) => [marca, { categoria, segmento }])
);

const ORTOPEDIA_MARCA_TYPOS: [RegExp, string][] = [
  [/^OTTO ?BOCKK?$/, "OTTOBOCK"],
  [/^OTTTOBOCK$/, "OTTOBOCK"],
  [/^FORESTA ?DENT$/, "FORESTADENT"],
  [/^FIOR (GENTZ|& GENTZ)$/, "FIOR & GENTZ"],
  [/^CANWELLL?$/, "CANWELL"],
  [/^KLS( MARTIN)?( GROUP)?$/, "KLS MARTIN"],
  [/^KLS MATIN$/, "KLS MARTIN"],
  [/^(ULRICH|URLICH) ME[DI]?ICAL$/, "ULRICH MEDICAL"],
  [/^R ?82 A\/?S$/, "R82"],
  [/^TENCIDENT$/, "TECNIDENT"],
  [/^AICARST$/, "AIRCAST"],
];

function normalizeOrtopediaMarcaTypo(marca: string): string {
  for (const [re, canon] of ORTOPEDIA_MARCA_TYPOS) {
    if (re.test(marca)) return canon;
  }
  return marca;
}

function ortopediaCategoriaSinMarca(descripcion: string): { categoria: OrtopediaCategoria; segmento: string } {
  const d = (descripcion || "").toUpperCase();
  if (d.includes("CALZADO")) return { categoria: "Calzado Ortopedico", segmento: "Calzado Ortopedico" };
  if (d.includes("COLUMNA")) return { categoria: "Implantes de Columna", segmento: "Sistemas de Fijacion Vertebral" };
  if (d.includes("CUELLO")) return { categoria: "Inmovilizadores y Ferulas", segmento: "Collares Cervicales" };
  if (d.includes("MULETA") || d.includes("BASTON")) return { categoria: "Ayudas para la Marcha", segmento: "Muletas y Bastones" };
  return { categoria: "Otros", segmento: "Otros" };
}

function ortopediaSegmentoMarchaPorDescripcion(descripcion: string): string {
  const d = (descripcion || "").toUpperCase();
  if (d.includes("MULETA") || d.includes("BASTON")) return "Muletas y Bastones";
  return "Andadores y Ayudas de Marcha";
}

function ortopediaCategoriaSlug(
  categoria: OrtopediaCategoria,
  segmento: string
): "andadores" | "bastones" | "calzado_ortopedico" | null {
  if (categoria === "Calzado Ortopedico") return "calzado_ortopedico";
  if (categoria === "Ayudas para la Marcha") {
    if (segmento === "Andadores y Ayudas de Marcha") return "andadores";
    if (segmento === "Muletas y Bastones") return "bastones";
  }
  return null;
}

/**
 * Clasifica una fila cruda de la exportacion IA40 (NCM 9021.10.10) en
 * marca/modelo/color/segmento + la categoria interna a la que pertenece
 * (o null si no es ninguna de las 3 que trackea este dashboard).
 *
 * Formato del texto de aduana en esta NCM (columna "sufijos", distinto al
 * de sillas de ruedas): "<MARCA> SIN MODELO <codigo> (CA00)".
 */
export function parseOrtopedia9021Row(row: any): OrtopediaParsed {
  const sufijoRaw: string = row.sufijos ?? "";
  const razonSocial: string = row.nombre ?? "";
  const descripcionPosicion: string = row.posicion_descripcion ?? "";

  const textoSinParentesis = sufijoRaw.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const sinModeloMatch = /\sSIN\s+MODELO\b/i.exec(textoSinParentesis);

  let marcaRaw: string;
  let modelo: string;
  if (sinModeloMatch) {
    marcaRaw = textoSinParentesis.slice(0, sinModeloMatch.index).trim();
    modelo = textoSinParentesis.slice(sinModeloMatch.index + sinModeloMatch[0].length).trim();
  } else {
    marcaRaw = textoSinParentesis;
    modelo = "";
  }

  const marcaVacia = marcaRaw.trim() === "" || /^(SIN\s+MARCA|S\/M|NO\s+POSEE|0)\b/i.test(marcaRaw.trim());

  if (marcaVacia) {
    const { categoria, segmento } = ortopediaCategoriaSinMarca(descripcionPosicion);
    return {
      marca: razonSocial || "Sin Identificar",
      modelo: modelo || textoSinParentesis,
      color: "S/D",
      segmento,
      categoriaSlug: ortopediaCategoriaSlug(categoria, segmento),
    };
  }

  let marcaNorm = marcaRaw.toUpperCase().replace(/[.,/]/g, " ").replace(/\s+/g, " ").trim();
  marcaNorm = normalizeOrtopediaMarcaTypo(marcaNorm);

  const dictEntry = ORTOPEDIA_MARCA_DICT[marcaNorm];
  if (!dictEntry) {
    const { categoria, segmento } = ortopediaCategoriaSinMarca(descripcionPosicion);
    return {
      marca: marcaRaw,
      modelo: modelo || textoSinParentesis,
      color: "S/D",
      segmento,
      categoriaSlug: ortopediaCategoriaSlug(categoria, segmento),
    };
  }

  let { categoria, segmento } = dictEntry;
  if (segmento === "(segun descripcion)") {
    segmento = ortopediaSegmentoMarchaPorDescripcion(descripcionPosicion);
  }

  return {
    marca: marcaRaw,
    modelo: modelo || textoSinParentesis,
    color: "S/D",
    segmento,
    categoriaSlug: ortopediaCategoriaSlug(categoria, segmento),
  };
}
