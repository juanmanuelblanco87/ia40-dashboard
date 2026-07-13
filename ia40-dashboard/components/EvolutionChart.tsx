"use client";

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

interface Props {
  data: SeriesPoint[];
  groupBy: "marca" | "modelo" | "proveedor";
  metric: Metric;
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** "2026-04-01" -> "Abril 2026" */
function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  const mes = MESES[Number(m) - 1] ?? m;
  return `${mes} ${y}`;
}

/** Pivotea la serie plana (una fila por mes+dimension) a un formato apto para recharts. */
function pivot(data: SeriesPoint[], groupBy: Props["groupBy"], metric: Metric) {
  const periods = Array.from(new Set(data.map((d) => d.period))).sort();
  const keys = Array.from(new Set(data.map((d) => d[groupBy] ?? "sin_dato")));

  const rows = periods.map((period) => {
    const row: Record<string, any> = { period };
    for (const key of keys) row[key] = 0;
    for (const d of data.filter((x) => x.period === period)) {
      const key = (d[groupBy] ?? "sin_dato") as string;
      row[key] = (row[key] ?? 0) + Number(d[metric]);
    }
    return row;
  });

  return { rows, keys };
}

const COLORS = ["#4f8cff", "#ff8a4f", "#4fffa0", "#ff4f8c", "#c04fff", "#ffd24f"];

export default function EvolutionChart({ data, groupBy, metric }: Props) {
  if (data.length === 0) {
    return <p style={{ color: "var(--muted)" }}>Todavia no hay datos sincronizados para esta seleccion.</p>;
  }

  const { rows, keys } = pivot(data, groupBy, metric);

  return (
    <ResponsiveContainer width="100%" height={380}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2e37" />
        <XAxis dataKey="period" stroke="#9aa1ad" tickFormatter={formatPeriod} />
        <YAxis stroke="#9aa1ad" />
        <Tooltip
          contentStyle={{ background: "#171a21", border: "1px solid #2a2e37" }}
          labelFormatter={(label) => formatPeriod(String(label))}
        />
        <Legend />
        {keys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
