import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Repositorio de escenarios guardados (21/07/2026) -- pedido explicito del
 * usuario: "Hay que dejar un repositorio para guardar la simulación de
 * escenarios ya creados y que guarde todas las variables estaticas (dolar
 * a ese momento, cbm, pvp etc.) y antes de guardarlo preguntar usuario
 * para luego poder filtrar por usuario."
 *
 * Cada fila es una FOTO completa de un calculo puntual (el resultado de
 * /api/calc/run + los supuestos vigentes en ese momento), no una
 * referencia -- si despues cambia el tipo de cambio o el CBM del producto,
 * los escenarios viejos no se ven afectados (es justamente el punto: poder
 * comparar "qué hubiera pasado" con los numeros de cada momento).
 *
 * Se guardan por separado algunas columnas usadas para filtrar rapido
 * (usuario, producto, fecha) + 2 columnas JSONB con la foto completa
 * (supuestos + resultado), para no tener que ir agregando columnas cada
 * vez que se agrega un campo nuevo al calculo.
 */

interface GuardarEscenarioBody {
  usuario: string;
  productTypeId: number;
  nombreProducto: string;
  fobUsd: number;
  pvpFuente: string;
  envioFuente: string;
  supuestos: any;
  productType: any;
  resultado: any;
}

function toRow(row: any) {
  return {
    id: row.id,
    usuario: row.usuario,
    nombreProducto: row.nombre_producto,
    fobUsd: Number(row.fob_usd),
    pvpMeliArsConIva: Number(row.pvp_meli_ars_con_iva),
    pvpFuente: row.pvp_fuente,
    tipoCambioArs: Number(row.tipo_cambio_ars),
    arancelPct: row.arancel_pct != null ? Number(row.arancel_pct) : null,
    ivaPct: row.iva_pct != null ? Number(row.iva_pct) : null,
    cbmM3: row.cbm_m3 != null ? Number(row.cbm_m3) : null,
    tamanoEnvio: row.tamano_envio,
    envioFuente: row.envio_fuente,
    margenMeliPct: row.margen_meli_pct != null ? Number(row.margen_meli_pct) : null,
    margenDistribucionPct: row.margen_distribucion_pct != null ? Number(row.margen_distribucion_pct) : null,
    supuestos: row.supuestos_json,
    productType: row.product_type_json,
    resultado: row.resultado_json,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/calc/scenarios?usuario=X
 * Lista escenarios guardados, mas nuevos primero. `usuario` es opcional
 * (para el filtro del frontend); sin filtro devuelve todos.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const usuario = searchParams.get("usuario");

  const rows = usuario
    ? await query<any>(`select * from calc_scenarios where usuario=$1 order by created_at desc limit 300`, [usuario])
    : await query<any>(`select * from calc_scenarios order by created_at desc limit 300`);

  const usuarios = await query<any>(`select distinct usuario from calc_scenarios order by usuario asc`);

  return NextResponse.json({
    escenarios: rows.map(toRow),
    usuarios: usuarios.map((r) => r.usuario as string),
  });
}

/**
 * POST /api/calc/scenarios
 * Guarda una foto completa de un calculo ya corrido -- el frontend manda
 * exactamente lo que ya tiene en pantalla (resultado de /api/calc/run +
 * los supuestos vigentes), no se vuelve a calcular nada aca.
 */
export async function POST(req: Request) {
  let body: GuardarEscenarioBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const usuario = String(body?.usuario ?? "").trim();
  if (!usuario) {
    return NextResponse.json({ error: "Falta indicar el usuario que guarda el escenario." }, { status: 400 });
  }
  if (!body?.resultado || !body?.supuestos || !body?.productType) {
    return NextResponse.json({ error: "Faltan datos del cálculo para guardar el escenario." }, { status: 400 });
  }

  const margenMeliPct = body.resultado?.meli?.margenPctSobreConIva ?? null;
  const margenDistribucionPct = body.resultado?.distribucion?.margenPctSobreConIva ?? null;

  const inserted = await query<any>(
    `insert into calc_scenarios (
       usuario, product_type_id, nombre_producto, fob_usd, pvp_meli_ars_con_iva, pvp_fuente,
       tipo_cambio_ars, arancel_pct, iva_pct, cbm_m3, tamano_envio, envio_fuente,
       margen_meli_pct, margen_distribucion_pct, supuestos_json, product_type_json, resultado_json
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     returning *`,
    [
      usuario,
      body.productTypeId ?? null,
      body.nombreProducto ?? body.productType?.nombre ?? "",
      body.fobUsd,
      body.resultado?.meli?.pvpConIva ?? null,
      body.pvpFuente ?? null,
      body.supuestos?.tipoCambioArs ?? null,
      body.productType?.arancel_pct ?? null,
      body.productType?.iva_pct ?? null,
      body.productType?.cbm_m3 ?? null,
      body.productType?.tamano_envio ?? null,
      body.envioFuente ?? null,
      margenMeliPct,
      margenDistribucionPct,
      JSON.stringify(body.supuestos),
      JSON.stringify(body.productType),
      JSON.stringify(body.resultado),
    ]
  );

  return NextResponse.json({ escenario: toRow(inserted[0]) });
}
