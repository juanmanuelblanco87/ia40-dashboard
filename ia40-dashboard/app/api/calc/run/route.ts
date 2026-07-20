import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { calcularImportacion, type CalcSupuestos, type CalcProducto, type TamanoEnvio } from "@/lib/importCalc";
import { estimarArancel, estimarIva, estimarCbm, estimarPvpMercado, CalcAiError } from "@/lib/calcAi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function supuestosToCalc(row: any): CalcSupuestos {
  return {
    tipoCambioArs: Number(row.tipo_cambio_ars),
    comisionMlPct: Number(row.comision_ml_pct),
    iibbPct: Number(row.iibb_pct),
    padsPct: Number(row.pads_pct),
    tasaEstadisticaPct: Number(row.tasa_estadistica_pct),
    ley25413Pct: Number(row.ley_25413_pct),
    seguroUsdUnidad: Number(row.seguro_usd_unidad),
    feeBajoTicketArs: Number(row.fee_bajo_ticket_ars),
    umbralBajoValorArs: Number(row.umbral_bajo_valor_ars),
    descuentoDistribucionPct: Number(row.descuento_distribucion_pct),
    fleteMaritimoUsd: Number(row.flete_maritimo_usd),
    forwarderUsd: Number(row.forwarder_usd),
    despachanteUsd: Number(row.despachante_usd),
    thcUsd: Number(row.thc_usd),
    fleteLocalUsd: Number(row.flete_local_usd),
    manipuleoUsd: Number(row.manipuleo_usd),
    capacidadCbmContenedor: Number(row.capacidad_cbm_contenedor),
    envioChicoArs: Number(row.envio_chico_ars),
    envioMedianoArs: Number(row.envio_mediano_ars),
    envioGrandeArs: Number(row.envio_grande_ars),
  };
}

function esTamanoEnvioValido(v: any): v is TamanoEnvio {
  return v === "chico" || v === "mediano" || v === "grande";
}

function productoRowToNumbers(row: any) {
  return {
    ...row,
    arancel_pct: row.arancel_pct != null ? Number(row.arancel_pct) : null,
    iva_pct: row.iva_pct != null ? Number(row.iva_pct) : null,
    trader_pct: Number(row.trader_pct ?? 0),
    tamano_envio: esTamanoEnvioValido(row.tamano_envio) ? row.tamano_envio : "mediano",
    cbm_m3: row.cbm_m3 != null ? Number(row.cbm_m3) : null,
    pvp_ars_estimado: row.pvp_ars_estimado != null ? Number(row.pvp_ars_estimado) : null,
  };
}

/**
 * POST /api/calc/run  { productTypeId, fobUsd, pvpArsManual? }
 *
 * Corre el calculo completo del Calculador de Importacion para un tipo de
 * producto y un FOB dados. Autocompleta (y cachea) cualquier campo de IA
 * que todavia falte -- arancel/IVA/CBM en `calc_product_types` normalmente
 * ya se estiman al crear el tipo de producto (ver POST
 * /api/calc/product-types), pero esto es una red de seguridad por si esa
 * corrida fallo parcialmente (mismo criterio de "reintentar lo pendiente"
 * que ya se usa en getOrSearchModelPvp()).
 *
 * El PVP de MeLi es MANUAL si se manda `pvpArsManual` (pedido explicito del
 * usuario: "el PVP es algo que tambien quiero colocar yo manualmente"); si
 * no se manda, se usa el PVP de mercado cacheado en el tipo de producto, o
 * se estima por IA y se cachea ahi para la proxima vez. Un PVP manual NO
 * pisa el valor cacheado del tipo de producto (es un dato de ESTE calculo
 * puntual, no una correccion permanente del catalogo).
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const productTypeId = Number(body?.productTypeId);
  const fobUsd = Number(body?.fobUsd);
  const pvpArsManual =
    body?.pvpArsManual !== undefined && body?.pvpArsManual !== null && body?.pvpArsManual !== ""
      ? Number(body.pvpArsManual)
      : null;

  if (!Number.isFinite(productTypeId)) {
    return NextResponse.json({ error: "Falta 'productTypeId'" }, { status: 400 });
  }
  if (!Number.isFinite(fobUsd) || fobUsd <= 0) {
    return NextResponse.json({ error: "'fobUsd' invalido" }, { status: 400 });
  }

  await query(`insert into calc_supuestos (id) values (1) on conflict (id) do nothing`);
  const supuestosRows = await query<any>(`select * from calc_supuestos where id=1`);
  const supuestos = supuestosToCalc(supuestosRows[0]);

  const rows = await query<any>(`select * from calc_product_types where id=$1`, [productTypeId]);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Tipo de producto no encontrado" }, { status: 404 });
  }
  let producto = productoRowToNumbers(rows[0]);

  // Red de seguridad: completa arancel/IVA/CBM si por algun motivo faltan.
  if (producto.arancel_pct == null) {
    try {
      const r = await estimarArancel(producto.nombre, producto.ncm_code);
      await query(
        `update calc_product_types set arancel_pct=$1, arancel_confianza=$2, arancel_razonamiento=$3,
           arancel_status='found', arancel_fetched_at=now(), updated_at=now() where id=$4`,
        [r.pct, r.confianza, r.razonamiento, productTypeId]
      );
      producto.arancel_pct = r.pct;
    } catch (err: any) {
      const msg = err instanceof CalcAiError ? err.message : String(err?.message ?? err);
      return NextResponse.json({ error: `No se pudo estimar el arancel: ${msg}` }, { status: 200 });
    }
  }
  if (producto.iva_pct == null) {
    try {
      const r = await estimarIva(producto.nombre);
      await query(
        `update calc_product_types set iva_pct=$1, iva_confianza=$2, iva_razonamiento=$3,
           iva_status='found', iva_fetched_at=now(), updated_at=now() where id=$4`,
        [r.pct, r.confianza, r.razonamiento, productTypeId]
      );
      producto.iva_pct = r.pct;
    } catch (err: any) {
      const msg = err instanceof CalcAiError ? err.message : String(err?.message ?? err);
      return NextResponse.json({ error: `No se pudo estimar el IVA: ${msg}` }, { status: 200 });
    }
  }
  if (producto.cbm_m3 == null) {
    try {
      const r = await estimarCbm(producto.nombre);
      await query(
        `update calc_product_types set cbm_m3=$1, cbm_confianza=$2, cbm_razonamiento=$3,
           cbm_status='found', cbm_fetched_at=now(), updated_at=now() where id=$4`,
        [r.m3, r.confianza, r.razonamiento, productTypeId]
      );
      producto.cbm_m3 = r.m3;
    } catch (err: any) {
      const msg = err instanceof CalcAiError ? err.message : String(err?.message ?? err);
      return NextResponse.json({ error: `No se pudo estimar el CBM: ${msg}` }, { status: 200 });
    }
  }

  // Resolver PVP de MeLi: manual > cacheado > estimado por IA (y cacheado).
  let pvpMeliArsConIva: number;
  let pvpFuente: "manual" | "cache" | "ia";
  if (pvpArsManual != null && pvpArsManual > 0) {
    pvpMeliArsConIva = pvpArsManual;
    pvpFuente = "manual";
  } else if (producto.pvp_ars_estimado != null) {
    pvpMeliArsConIva = producto.pvp_ars_estimado;
    pvpFuente = "cache";
  } else {
    try {
      const r = await estimarPvpMercado(producto.nombre);
      if (r.pvpArsConIva == null) {
        return NextResponse.json(
          { error: "No se encontro un PVP de mercado para este tipo de producto. Cargá uno manual para poder calcular." },
          { status: 200 }
        );
      }
      await query(
        `update calc_product_types set pvp_ars_estimado=$1, pvp_confianza=$2, pvp_razonamiento=$3,
           pvp_status='found', pvp_fetched_at=now(), updated_at=now() where id=$4`,
        [r.pvpArsConIva, r.confianza, r.razonamiento, productTypeId]
      );
      producto.pvp_ars_estimado = r.pvpArsConIva;
      pvpMeliArsConIva = r.pvpArsConIva;
      pvpFuente = "ia";
    } catch (err: any) {
      const msg = err instanceof CalcAiError ? err.message : String(err?.message ?? err);
      return NextResponse.json({ error: `No se pudo estimar el PVP de mercado: ${msg}` }, { status: 200 });
    }
  }

  const calcProducto: CalcProducto = {
    arancelPct: producto.arancel_pct ?? 0,
    ivaPct: producto.iva_pct ?? 0.21,
    traderPct: producto.trader_pct,
    cbmM3: producto.cbm_m3 ?? 0,
    tamanoEnvio: producto.tamano_envio,
  };

  const resultado = calcularImportacion({
    fobUsd,
    pvpMeliArsConIva,
    supuestos,
    producto: calcProducto,
  });

  return NextResponse.json({
    productType: producto,
    supuestos,
    pvpFuente,
    resultado,
  });
}
