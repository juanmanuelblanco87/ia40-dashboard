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
// Especifico de sillas de ruedas: tabla aprendida del dataset de esa
// categoria, no se reutiliza por defecto en las categorias nuevas (se pasa
// explicitamente en la config de "sillas_de_ruedas" mas abajo).
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
  /** Diccionario multi-palabra de marca. Por defecto: BRAND_MULTI_WORD_DICT (compartido). */
  multiWordDict?: [string, string][];
  /** Marca de una sola palabra. Por defecto: BRAND_SINGLE_WORD_OVERRIDE (compartido). */
  singleWordOverride?: Record<string, string>;
  /** Typos conocidos en la primera palabra. Por defecto: BRAND_TYPO_FIXES (compartido). */
  typoFixes?: Record<string, string>;
  /** Palabras vacias societarias para el fallback por Razon Social. Por defecto: SOCIETARY_STOPWORDS (compartido). */
  societaryStopwords?: Set<string>;
  /** Diccionario de colores. Por defecto: COLOR_DICT (compartido). */
  colorDict?: [string, string][];
  /** Codigos "YC<n>" -> color canonico (especifico de sillas de ruedas / Magesa). Por defecto: ninguno. */
  ycCodeMap?: Record<string, string>;
  /** Color por defecto cuando no se detecta ninguno. Por defecto: "Negro". */
  defaultColor?: string;
  /** Paso 11.1: palabra clave en Modelo -> segmento (maxima prioridad). Por defecto: ninguno. */
  segmentoKeywords?: [string, string][];
  /** Paso 11.2: marca exacta + prefijo de Modelo -> segmento. Por defecto: ninguno. */
  segmentoBrandPrefix?: [string, string, string][];
  /** Paso 11.3: marca -> segmento por defecto. Por defecto: ninguno. */
  segmentoBrandDefault?: Record<string, string>;
  /** Paso 11.4: segmento si nada de lo anterior matcheo. Obligatorio: cada categoria define el suyo. */
  segmentoFallback: string;
}

/**
 * Crea un parser de marca/modelo/color/segmento para una categoria,
 * reutilizando el mismo algoritmo que se armo originalmente para
 * "Sillas de ruedas" (ver pasos 1-11 en los comentarios de cada funcion
 * interna), parametrizado por los diccionarios que pasa `config`.
 */
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

  // Paso 9: contador "Modelo N" correlativo por Razon Social + Precio
  // Unitario, con estado propio por instancia de parser (o sea, por
  // categoria) para no mezclar numeraciones entre categorias distintas.
  // NOTA: este contador vive en memoria del proceso. Dentro de una misma
  // corrida de sync es correcto (se reutiliza el mismo numero para la misma
  // combinacion razonSocial+precio); entre corridas distintas (cada una un
  // proceso nuevo en Vercel) se reinicia. Segun los datos reales analizados
  // de sillas de ruedas, este camino casi no se usa (casi todo trae un
  // codigo de referencia utilizable como Modelo), asi que por ahora no se
  // persiste en la base.
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

  /**
   * @param sufijoTextRaw  Texto crudo de "SUB ITEMS - SUFIJOS" (puede venir vacio/null).
   * @param razonSocial    Razon social del importador (columna A), tal cual.
   * @param precioUnitario Precio unitario FOB del sub-item, para el paso 9.
   */
  function parseCore(
    sufijoTextRaw: string | null | undefined,
    razonSocial: string,
    precioUnitario?: number | null
  ): { marca: string; modelo: string } {
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
      if (typoFixes[firstUpper]) {
        words[0] = typoFixes[firstUpper];
        text = words.join(" ");
      }
    }
    const textUpper = text.toUpperCase();

    // Paso 5: diccionario multi-palabra (match mas largo primero).
    for (const [key, canonical] of multiWordSorted) {
      if (textUpper === key || textUpper.startsWith(key + " ")) {
        const modelo = text.slice(key.length).trim();
        return finalize(canonical, modelo, razonSocial, precioUnitario);
      }
    }

    // Paso 6: marca de una sola palabra ya conocida (tabla OVERRIDE).
    words = text.split(" ").filter(Boolean);
    if (words.length > 0) {
      const firstUpper = words[0].toUpperCase();
      if (singleWordOverride[firstUpper]) {
        const marca = singleWordOverride[firstUpper];
        const modelo = words.slice(1).join(" ").trim();
        return finalize(marca, modelo, razonSocial, precioUnitario);
      }
    }

    // Paso 7: fallback por Razon Social (probar prefijo de 3, 2 o 1 palabras
    // de la razon social sin las palabras vacias societarias).
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

    // Paso 8: fallback generico -> primera palabra como marca (Title Case,
    // o mayusculas si es sigla de <=3 letras), resto como modelo.
    if (words.length === 0) {
      return finalize(razonSocial, "", razonSocial, precioUnitario);
    }
    const marca = titleCase(words[0]);
    const modelo = words.slice(1).join(" ").trim();
    return finalize(marca, modelo, razonSocial, precioUnitario);
  }

  /**
   * Paso 10: separa el color del texto de Modelo (ya limpio, pasos 1-9),
   * para que variantes de color del mismo modelo (ej. "MEWA BLACK" / "MEWA
   * LIGHT GRAY") no queden como modelos distintos. Devuelve el modelo sin
   * el color (si se detecto) y el color canonico (o el color por defecto
   * de la categoria si no hay informacion de color en el texto).
   */
  function extractColor(modelo: string): { modelo: string; color: string } {
    if (!modelo) return { modelo, color: defaultColor };

    // Paso 10.1: palabra de color conocida al final, con sufijo " YC<codigo>" opcional
    // (algunos registros traen un espacio entre "YC" y el codigo, ej. "YC B007").
    for (const [word, canonical] of colorSorted) {
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
      const known = ycCodeMap[code];
      if (known) {
        return { modelo: ycMatch[1].trim(), color: known };
      }
      // Codigo no aprendido: igual se quita del modelo (para unificar), pero
      // el color queda por defecto porque no sabemos cual es realmente.
      return { modelo: ycMatch[1].trim(), color: defaultColor };
    }

    // Paso 10.3: sin color detectado.
    return { modelo, color: defaultColor };
  }

  /**
   * Paso 11: clasifica cada fila en un segmento a partir de Marca y Modelo
   * YA limpios (sin color). Orden de evaluacion (el primero que matchea
   * gana):
   *   11.1 palabra clave en Modelo (max prioridad, no mira la marca)
   *   11.2 Marca exacta + Modelo contiene un prefijo de linea de producto
   *   11.3 Marca por defecto
   *   11.4 fallback de la categoria si nada matcheo
   */
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

// ---- Paso 11.1: palabra clave en Modelo (maxima prioridad) ----
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

// ---- Paso 11.2: marca + prefijo de Modelo (marcas con lineas mixtas) ----
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

// ---- Paso 11.3: marca por defecto (si no matcheo 11.1 ni 11.2) ----
// Nota: algunas claves son la Razon Social completa (ej. "JEPOINT S. A.",
// "TENACTA SOCIEDAD ANONIMA", "TRINIDAD INSUMOS S.R.L.") porque para esas
// filas el resto del parser uso el fallback de Razon Social (paso 7) o el
// fallback generico (paso 8) como Marca, no una marca del diccionario.
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

// ============================================================
// Config: Sillas de Ruedas Electricas -- Segmento propio. NO reutiliza el
// esquema de sillas manuales (Sillas Infantiles / Ultra Livianas / etc.):
// son ejes de clasificacion distintos, pensados especificamente para
// sillas con motor (interior vs. exterior, plegable, reclinable,
// bariatrica). Taxonomia validada con el usuario 15/07/2026. Confianza
// BAJA en las keywords (ver nota de cabecera del archivo).
// ============================================================
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

// ============================================================
// Configs: 6 categorias nuevas restantes -- taxonomia de Segmento propia
// por categoria, validada con el usuario 15/07/2026 (ver
// docs/ncm_nuevas_categorias.md para el contexto de cada categoria).
// Confianza BAJA en las keywords (ver nota de cabecera del archivo): se
// ajustan/completan con el primer sync real de cada categoria.
// ============================================================

// ---- Andadores ----
const ANDADORES_SEGMENTO_KEYWORDS: [string, string][] = [
  ["PEDIATRIC", "Andador Pediátrico"],
  ["PEDIATRICO", "Andador Pediátrico"],
  ["JUNIOR", "Andador Pediátrico"],
  ["KIDS", "Andador Pediátrico"],
  ["ROLLATOR", "Rollator (4 Ruedas)"],
  ["4 WHEEL", "Rollator (4 Ruedas)"],
  ["FOUR WHEEL", "Rollator (4 Ruedas)"],
  ["4 RUEDAS", "Rollator (4 Ruedas)"],
  ["CUATRO RUEDAS", "Rollator (4 Ruedas)"],
  ["2 WHEEL", "Andador 2 Ruedas"],
  ["TWO WHEEL", "Andador 2 Ruedas"],
  ["2 RUEDAS", "Andador 2 Ruedas"],
  ["DOS RUEDAS", "Andador 2 Ruedas"],
  ["RIGID", "Andador Rígido"],
  ["FIXED", "Andador Rígido"],
  ["RIGIDO", "Andador Rígido"],
];
const andadoresParser = createCategoryParser({
  segmentoKeywords: ANDADORES_SEGMENTO_KEYWORDS,
  segmentoFallback: "Andador Estándar",
});

// ---- Bastones ----
const BASTONES_SEGMENTO_KEYWORDS: [string, string][] = [
  ["TRIPOD", "Bastón Multipodal (Trípode/Cuádruple)"],
  ["TRIPODE", "Bastón Multipodal (Trípode/Cuádruple)"],
  ["QUAD", "Bastón Multipodal (Trípode/Cuádruple)"],
  ["CUADRUPLE", "Bastón Multipodal (Trípode/Cuádruple)"],
  ["4 POINT", "Bastón Multipodal (Trípode/Cuádruple)"],
  ["3 POINT", "Bastón Multipodal (Trípode/Cuádruple)"],
  ["FOREARM", "Bastón Canadiense"],
  ["CANADIAN", "Bastón Canadiense"],
  ["CANADIENSE", "Bastón Canadiense"],
  ["SEAT", "Bastón con Asiento"],
  ["ASIENTO", "Bastón con Asiento"],
];
const bastonesParser = createCategoryParser({
  segmentoKeywords: BASTONES_SEGMENTO_KEYWORDS,
  segmentoFallback: "Bastón Simple",
});

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
// Importante: "SEMI ELECTRIC*" tiene que ir ANTES que "ELECTRIC*" en la
// lista (el matching es "primer keyword que aparece en el texto, en este
// orden", y "ELECTRIC" es substring de "SEMI ELECTRIC").
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
  // Importante: SIEMPRE se llama al parser, incluso si "sufijos" viene vacio.
  // El parser mismo sabe que hacer en ese caso (usa la Razon Social del
  // importador como Marca).
  sillas_de_ruedas: sillasDeRuedasParser,
  sillas_ruedas_electricas: sillasRuedasElectricasParser,
  andadores: andadoresParser,
  bastones: bastonesParser,
  almohadones_ortopedicos: almohadonesOrtopedicosParser,
  sillas_ducha: sillasDuchaParser,
  elevadores_inodoro: elevadoresInodoroParser,
  camas_hospitalarias: camasHospitalariasParser,
};

/** Categorias que necesitan el flujo de EXPORTACION (con Sufijos) en vez de /data normal. */
export function categoryUsesExportFlow(categorySlug: string): boolean {
  return categorySlug in CATEGORY_PARSERS;
}
