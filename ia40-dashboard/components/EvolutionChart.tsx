"use client";

import { useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface SeriesPoint {
  period: string;
  marca: string | null;
  modelo: string | null;
  proveedor: string;
  total_fob_dolars: string | number;
  total_unidades: string | number;
  record_count: number;
}

export type Metric = "total_fob_dolars" | "total_unidades";

export interface PivotResult {
  rows: Record<string, any>[];
  keys: string[];
  periods: string[];
}

interface Props {
  data: SeriesPoint[];
  groupBy: "marca" | "modelo" | "proveedor";
  metric: Metric;
  /** Cuantas series individuales mostrar antes de agrupar el resto en "Otros". */
  topN?: number;
  /** Se llama cada vez que se recalcula el pivot, para que el padre pueda
   * mostrar la misma data en una tabla debajo del grafico. */
  onPivotChange?: (pivot: PivotResult) => void;
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** "2026-04-01" -> "Abril 2026" */
export function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  const mes = MESES[Number(m) - 1] ?? m;
  return `${mes} ${y}`;
}

/** Sin decimales, con "." como separador de miles (formato AR). */
export function fmtNumber(n: number): string {
  return Math.round(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

const OTROS_KEY = "Otros";

/**
 * Pivotea la serie plana (una fila por mes+dimension) a un formato apto para
 * recharts, mostrando solo las `topN` series con mayor total acumulado (por
 * la metrica elegida) y agrupando el resto en una serie "Otros". Las series
 * quedan ordenadas de mayor a menor total, con "Otros" siempre al final.
 */
function pivot(data: SeriesPoint[], groupBy: Props["groupBy"], metric: Metric, topN: number): PivotResult {
  const periods = Array.from(new Set(data.map((d) => d.period))).sort();

  // Total acumulado por key (para ordenar y elegir el top N).
  const totals = new Map<string, number>();
  for (const d of data) {
    const key = (d[groupBy] ?? "sin_dato") as string;
    totals.set(key, (totals.get(key) ?? 0) + Number(d[metric]));
  }

  const sortedKeys = Array.from(totals.keys()).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  const topKeys = sortedKeys.slice(0, topN);
  const restKeys = new Set(sortedKeys.slice(topN));
  const keys = restKeys.size > 0 ? [...topKeys, OTROS_KEY] : topKeys;

  const rows = periods.map((period) => {
    const row: Record<string, any> = { period };
    for (const key of keys) row[key] 
