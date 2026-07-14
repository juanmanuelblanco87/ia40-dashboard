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
  color: string | null;
  segmento: string | null;
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
  /** Valores que siempre se muestran como serie propia (ej. "Mugi"/"Magesa"),
   * aunque no entren en el top natural por total acumulado. */
  pinnedKeys?: string[];
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

/** Version compacta para el eje Y del grafico (ej. 1.500.000 -> "1,5M"). */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  }
  if (abs >= 1_000) {
    return (n / 1_000).toLocaleString("es-AR", { maximumFractionDigits: 0 }) + "K";
  }
  return fmtNumber(n);
}

const OTROS_KEY = "Otros";

/**
 * Pivotea la serie plana (una fila por mes+dimension) a un formato apto para
 * recharts, mostrando solo las `topN` series con mayor total acumulado (por
 * la metrica elegida) y agrupando el resto en una serie "Otros". Las series
 * quedan ordenadas de mayor a menor total, con "Otros" siempre al final.
 *
 * `pinnedKeys`: valores que siempre deben aparecer como serie individual
 * (ej. "Mugi"/"Magesa", nuestra marca y el lider del mercado), aunque su
 * total acumulado no alcance para entrar en el top natural. Ocupan lugar
 * dentro de las `topN` series (no se suman aparte), asi el grafico sigue
 * mostrando como maximo topN + "Otros" lineas.
 */
function pivot(
  data: SeriesPoint[],
  groupBy: Props["groupBy"],
  metric: Metric,
  topN: number,
  pinnedKeys: string[] = []
): PivotResult {
  const periods = Array.from(new Set(data.map((d) => d.period))).sort();

  // Total acumulado por key (para ordenar y elegir el top N).
  const totals = new Map<string, number>();
  for (const d of data) {
    const key = (d[groupBy] ?? "sin_dato") as string;
    totals.set(key, (totals.get(key) ?? 0) + Number(d[metric]));
  }

  const sortedKeys = Array.from(totals.keys()).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));

  const pinnedPresent = pinnedKeys.filter((k) => totals.has(k));
  const remainingSorted = sortedKeys.filter((k) => !pinnedPresent.includes(k));
  const topRemaining = remainingSorted.slice(0, Math.max(0, topN - pinnedPresent.length));
  const topKeys = [...pinnedPresent, ...topRemaining].sort(
    (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)
  );

  const topKeysSet = new Set(topKeys);
  const restKeys = new Set(sortedKeys.filter((k) => !topKeysSet.has(k)));
  const keys = restKeys.size > 0 ? [...topKeys, OTROS_KEY] : topKeys;

  const rows = periods.map((period) => {
    const row: Record<string, any> = { period };
    for (const key of keys) row[key] = 0;
    for (const d of data.filter((x) => x.period === period)) {
      const rawKey = (d[groupBy] ?? "sin_dato") as string;
      const key = restKeys.has(rawKey) ? OTROS_KEY : rawKey;
      row[key] = (row[key] ?? 0) + Number(d[metric]);
    }
    return row;
  });

  return { rows, keys, periods };
}

const COLORS = [
  "#4f8cff", "#ff8a4f", "#4fffa0", "#ff4f8c", "#c04fff", "#ffd24f",
  "#4fd7ff", "#ff4f4f", "#8cff4f",
];
const OTROS_COLOR = "#6b7280";

export default function EvolutionChart({ data, groupBy, metric, topN = 9, pinnedKeys = [], onPivotChange }: Props) {
  const result = pivot(data, groupBy, metric, topN, pinnedKeys);

  useEffect(() => {
    onPivotChange?.(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(result.keys), JSON.stringify(result.periods), groupBy, metric]);

  if (data.length === 0) {
    return <p style={{ color: "var(--muted)" }}>Todavia no hay datos sincronizados para esta seleccion.</p>;
  }

  const { rows, keys } = result;

  return (
    <ResponsiveContainer width="100%" height={380}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2e37" />
        <XAxis dataKey="period" stroke="#9aa1ad" tickFormatter={formatPeriod} tick={{ fontSize: 10 }} />
        <YAxis stroke="#9aa1ad" tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 11 }} width={44} />
        <Tooltip
          contentStyle={{ background: "#171a21", border: "1px solid #2a2e37" }}
          labelFormatter={(label) => formatPeriod(String(label))}
          formatter={(value: any) => fmtNumber(Number(value))}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={key === OTROS_KEY ? OTROS_COLOR : COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            strokeDasharray={key === OTROS_KEY ? "4 3" : undefined}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
