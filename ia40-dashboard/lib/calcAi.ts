/**
 * Motor de calculo del "Calculador de Importacion" (20/07/2026).
 *
 * Reconstruye la logica de la planilla STOKE_FOB_Objetivo_Fase1.xlsx del
 * cliente (hoja "Margen por FOB Conseguido"), verificada numero por numero
 * contra esa planilla antes de escribir este archivo -- ej. fila SILLA
 * RUEDAS CLASSIC: FOB=24, Trader=1.20 (5%), CIF=25 (=FOB+Seguro, el Trader
 * NO entra al CIF), Arancel=3.65 (=CIF*14.6%), Tasa=0.75 (=CIF*3%),
 * Ley25413=0.25 (=CIF*1%), Costo Nacionalizado USD = CIF+Arancel+Tasa+
 * Ley25413+Logistica+Trader = 48.31 -- coincide exacto con la planilla.
 *
 * A diferencia de la planilla original del cliente (pedidos explicitos del
 * usuario, 20/07/2026):
 *   - Arancel, IVA y CBM ya NO son fijos por categoria cerrada: son
 *     propiedades editables de un catalogo ABIERTO de "tipos de producto"
 *     (tabla calc_product_types), estimadas por IA la primera vez que se
 *     usa cada tipo (ver lib/calcAi.ts) y cacheadas ahi.
 *   - Trader default 0% (la planilla original asumia 5% siempre) --
 *     editable por tipo de producto para el caso puntual donde si se pague.
 *   - Se agrega el canal "Distribucion" (no existia en la planilla): PVP
 *     Distribucion = PVP MeLi x (1 - descuento_distribucion_pct, default
 *     35%), con SOLO IIBB como deduccion (sin comision ML, sin envio, sin
 *     PADS, sin fee de bajo ticket -- no se vende por MeLi).
 *
 * Esta funcion es pura (no toca la DB ni hace llamadas de red): recibe los
 * supuestos y los datos del tipo de producto ya resueltos (arancel/iva/cbm
 * ya sea cacheados o recien estimados por IA, y el PVP de MeLi ya sea
 * manual o estimado), y devuelve toda la cascada + ambos canales.
 */

export interface CalcSupuestos {
  tipoCambioArs: number;
  comisionMlPct: number;
  iibbPct: number;
  padsPct: number;
  tasaEstadisticaPct: number;
  ley25413Pct: number;
  seguroUsdUnidad: number;
  feeBajoTicketArs: number;
  umbralEnvioGratisArs: number;
  /** PVP Distribucion = PVP MeLi x (1 - este %). Default 0.35 (35%). */
  descuentoDistribucionPct: number;
  fleteMaritimoUsd: number;
  forwarderUsd: number;
  despachanteUsd: number;
  thcUsd: number;
  fleteLocalUsd: number;
  manipuleoUsd: number;
  capacidadCbmContenedor: number;
}

export interface CalcProducto {
  arancelPct: number;
  ivaPct: number;
  /** Comision de agente de compra sobre FOB. Default 0 (ver nota arriba). */
  traderPct: number;
  cbmM3: number;
  /** Costo de envio al cliente (ARS, CON IVA) -- solo se aplica si el PVP
   * de MeLi supera el umbral de envio gratis. Manual (ver calc_product_types). */
  envioArsConIva: number;
}

export interface CalcInput {
  fobUsd: number;
  /** PVP de MeLi ya resuelto (manual o estimado por IA), ARS CON IVA. */
  pvpMeliArsConIva: number;
  supuestos: CalcSupuestos;
  producto: CalcProducto;
}

export interface CalcCostoNacionalizado {
  traderUsd: number;
  seguroUsd: number;
  cifUsd: number;
  arancelUsd: number;
  tasaEstadisticaUsd: number;
  ley25413Usd: number;
  costoFijoPorCbmUsd: number;
  logisticaUsd: number;
  costoNacionalizadoUsd: number;
  costoNacionalizadoArs: number;
}

export interface CalcCanal {
  pvpConIva: number;
  pvpNeto: number;
  comisionMlArs: number;
  envioNetoArs: number;
  iibbArs: number;
  padsArs: number;
  feeBajoTicketArs: number;
  /** true si el PVP supero el umbral de envio gratis (solo relevante en MeLi). */
  envioGratisAplica: boolean;
  margenArs: number;
  /** Margen sobre venta neta de IVA (misma base que usa la planilla del cliente). */
  margenPctSobreNeto: number;
  /** Margen sobre PVP con IVA (precio de lista). */
  margenPctSobreConIva: number;
}

export interface CalcResult {
  costoNacionalizado: CalcCostoNacionalizado;
  meli: CalcCanal;
  distribucion: CalcCanal;
}

export function calcularImportacion(input: CalcInput): CalcResult {
  const { fobUsd, pvpMeliArsConIva, supuestos, producto } = input;

  // ---- 1) Del FOB al Costo Nacionalizado (USD -> ARS) ----
  const traderUsd = fobUsd * producto.traderPct;
  const seguroUsd = supuestos.seguroUsdUnidad;
  // CIF = FOB + Seguro. El Trader NO entra al CIF (verificado contra la
  // planilla del cliente: la comision del agente de compra no es parte
  // del valor aduanero declarado, se suma al costo nacionalizado aparte).
  const cifUsd = fobUsd + seguroUsd;
  const arancelUsd = cifUsd * producto.arancelPct;
  const tasaEstadisticaUsd = cifUsd * supuestos.tasaEstadisticaPct;
  const ley25413Usd = cifUsd * supuestos.ley25413Pct;

  const costoFijoContenedorUsd =
    supuestos.fleteMaritimoUsd +
    supuestos.forwarderUsd +
    supuestos.despachanteUsd +
    supuestos.thcUsd +
    supuestos.fleteLocalUsd +
    supuestos.manipuleoUsd;
  const costoFijoPorCbmUsd =
    supuestos.capacidadCbmContenedor > 0 ? costoFijoContenedorUsd / supuestos.capacidadCbmContenedor : 0;
  const logisticaUsd = producto.cbmM3 * costoFijoPorCbmUsd;

  const costoNacionalizadoUsd =
    cifUsd + arancelUsd + tasaEstadisticaUsd + ley25413Usd + logisticaUsd + traderUsd;
  const costoNacionalizadoArs = costoNacionalizadoUsd * supuestos.tipoCambioArs;

  const costoNacionalizado: CalcCostoNacionalizado = {
    traderUsd,
    seguroUsd,
    cifUsd,
    arancelUsd,
    tasaEstadisticaUsd,
    ley25413Usd,
    costoFijoPorCbmUsd,
    logisticaUsd,
    costoNacionalizadoUsd,
    costoNacionalizadoArs,
  };

  // ---- 2) Canal MeLi ----
  const envioGratisAplica = pvpMeliArsConIva >= supuestos.umbralEnvioGratisArs;
  const pvpMeliNeto = pvpMeliArsConIva / (1 + producto.ivaPct);
  const comisionMlArs = pvpMeliNeto * supuestos.comisionMlPct;
  // Envio (con IVA) solo se cobra al vendedor si el PVP supera el umbral de
  // envio gratis; por debajo de eso, el comprador paga su propio envio y en
  // cambio aplica el fee de bajo ticket.
  const envioConIvaMeli = envioGratisAplica ? producto.envioArsConIva : 0;
  const envioNetoMeliArs = envioConIvaMeli / (1 + producto.ivaPct);
  const iibbMeliArs = pvpMeliNeto * supuestos.iibbPct;
  // PADS se calcula sobre el PVP CON IVA (no sobre el neto) -- verificado
  // contra la planilla.
  const padsMeliArs = pvpMeliArsConIva * supuestos.padsPct;
  const feeBajoTicketMeliArs = envioGratisAplica ? 0 : supuestos.feeBajoTicketArs;

  const margenMeliArs =
    pvpMeliNeto -
    comisionMlArs -
    envioNetoMeliArs -
    iibbMeliArs -
    padsMeliArs -
    feeBajoTicketMeliArs -
    costoNacionalizadoArs;

  const meli: CalcCanal = {
    pvpConIva: pvpMeliArsConIva,
    pvpNeto: pvpMeliNeto,
    comisionMlArs,
    envioNetoArs: envioNetoMeliArs,
    iibbArs: iibbMeliArs,
    padsArs: padsMeliArs,
    feeBajoTicketArs: feeBajoTicketMeliArs,
    envioGratisAplica,
    margenArs: margenMeliArs,
    margenPctSobreNeto: pvpMeliNeto > 0 ? margenMeliArs / pvpMeliNeto : 0,
    margenPctSobreConIva: pvpMeliArsConIva > 0 ? margenMeliArs / pvpMeliArsConIva : 0,
  };

  // ---- 3) Canal Distribucion (no existe en la planilla original) ----
  // Pedido explicito del usuario: "sobre el PVP de MeLi colocar un 35% de
  // descuento (35% GM para el minorista)" -- solo se descuenta IIBB (nada
  // de comision ML, envio, PADS ni fee de bajo ticket, porque no se vende
  // por MeLi).
  const pvpDistConIva = pvpMeliArsConIva * (1 - supuestos.descuentoDistribucionPct);
  const pvpDistNeto = pvpDistConIva / (1 + producto.ivaPct);
  const iibbDistArs = pvpDistNeto * supuestos.iibbPct;
  const margenDistArs = pvpDistNeto - iibbDistArs - costoNacionalizadoArs;

  const distribucion: CalcCanal = {
    pvpConIva: pvpDistConIva,
    pvpNeto: pvpDistNeto,
    comisionMlArs: 0,
    envioNetoArs: 0,
    iibbArs: iibbDistArs,
    padsArs: 0,
    feeBajoTicketArs: 0,
    envioGratisAplica: false,
    margenArs: margenDistArs,
    margenPctSobreNeto: pvpDistNeto > 0 ? margenDistArs / pvpDistNeto : 0,
    margenPctSobreConIva: pvpDistConIva > 0 ? margenDistArs / pvpDistConIva : 0,
  };

  return { costoNacionalizado, meli, distribucion };
}
