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
  record_count: number;
}

interface Props {
  data: SeriesPoint[];
  groupBy: "marca" | "modelo" | "proveedor";
}

/** Pivotea la serie plana (una fila por mes+dimension) a un formato apto para recharts. */
function pivot(data: SeriesPoint[], groupBy: Props["groupBy"]) {
  const periods = Array.from(new Set(data.map((d) => d.period))).sort();
  const keys = Array.from(new Set(data.map((d) => d[groupBy] ?? "sin_dato")));

  const rows = periods.map((period) => {
    const row: Record<string, any> = { period };
    for (const key of keys) row[key] = 0;
    for (const d of data.filter((x) => x.period === period)) {
      const key = (d[groupBy] ?? "sin_dato") as string;
      row[key] = (row[key] ?? 0) + Number(d.total_fob_dolars);
    }
    return row;
  });

  return { rows, keys };
}

const COLORS = ["#4f8cff", "#ff8a4f", "#4fffa0", "#ff4f8c", "#c04fff", "#ffd24f"];

export default function EvolutionChart({ data, groupBy }: Props) {
  if (data.length === 0) {
    return <p style={{ color: "var(--muted)" }}>Todavia no hay datos sincronizados para esta seleccion.</p>;
  }

  const { rows, keys } = pivot(data, groupBy);

  return (
    <ResponsiveContainer width="100%" height={380}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2e37" />
        <XAxis dataKey="period" stroke="#9aa1ad" />
        <YAxis stroke="#9aa1ad" />
        <Tooltip contentStyle={{ background: "#171a21", border: "1px solid #2a2e37" }} />
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
