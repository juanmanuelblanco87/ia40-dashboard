"use client";

import { useEffect, useMemo, useState } from "react";
import EvolutionChart, { SeriesPoint, PivotResult, formatPeriod, fmtNumber } from "@/components/EvolutionChart";
import MultiSelectDropdown from "@/components/MultiSelectDropdown";

interface Category {
  id: number;
  slug: string;
  name: string;
  ncm_codes: string[];
}

interface TopEntry {
  key: string;
  value: number;
  other: number;
}

function computeTop(
  series: SeriesPoint[],
  periodSet: Set<string> | null,
  dimension: "proveedor" | "marca" | "modelo"
): { topFob: TopEntry | null; topUnidades: TopEntry | null } {
  const totals = new Map<string, { fob: number; uni: number }>();
  for (const s of series) {
    if (periodSet && !periodSet.has(s.period)) continue;
    const key = ((s as any)[dimension] ?? "sin_dato") as string;
    const cur = totals.get(key) ?? { fob: 0, uni: 0 };
    cur.fob += Number(s.total_fob_dolars) || 0;
    cur.uni += Number(s.total_unidades) || 0;
    totals.set(key, cur);
  }
  let topFob: TopEntry | null = null;
  let topUnidades: TopEntry | null = null;
  for (const [key, v] of totals) {
    if (!topFob || v.fob > topFob.value) topFob = { key, value: v.fob, other: v.uni };
    if (!topUnidades || v.uni > topUnidades.value) topUnidades = { key, value: v.uni, other: v.fob };
  }
  return { topFob, topUnidades };
}

function TopCard({ title, lastMonth, last12, last12Label }: {
  title: string;
  lastMonth: { topFob: TopEntry | null; topUnidades: TopEntry | null };
  last12: { topFob: TopEntry | null; topUnidades: TopEntry | null };
  last12Label: string;
}) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 240 }}>
      <h1 style={{ fontSize: 15, marginTop: 0, marginBottom: 10 }}>{title}</h1>

      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 2 }}>Ultimo mes</div>
      <div style={{ fontSize: 14, marginBottom: 2 }}>
        Por FOB: <strong>{lastMonth.topFob?.key ?? "-"}</strong>
        {lastMonth.topFob && <span style={{ color: "var(--muted)" }}> ({fmtNumber(lastMonth.topFob.value)} USD, {fmtNumber(lastMonth.topFob.other)} un.)</span>}
      </div>
      <div style={{ fontSize: 14, marginBottom: 10 }}>
        Por Unidades: <strong>{lastMonth.topUnidades?.key ?? "-"}</strong>
        {lastMonth.topUnidades && <span style={{ color: "var(--muted)" }}> ({fmtNumber(lastMonth.topUnidades.value)} un., {fmtNumber(lastMonth.topUnidades.other)} USD)</span>}
      </div>

      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 2 }}>{last12Label}</div>
      <div style={{ fontSize: 14, marginBottom: 2 }}>
        Por FOB: <strong>{last12.topFob?.key ?? "-"}</strong>
        {last12.topFob && <span style={{ color: "var(--muted)" }}> ({fmtNumber(last12.topFob.value)} USD, {fmtNumber(last12.topFob.other)} un.)</span>}
      </div>
      <div style={{ fontSize: 14 }}>
        Por Unidades: <strong>{last12.topUnidades?.key ?? "-"}</strong>
        {last12.topUnidades && <span style={{ color: "var(--muted)" }}> ({fmtNumber(last12.topUnidades.value)} un., {fmtNumber(last12.topUnidades.other)} USD)</span>}
      </div>
    </div>
  );
}

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [slug, setSlug] = useState<string>("");
  const [marcas, setMarcas] = useState<string[]>([]);
  const [modelo, setModelo] = useState<string>("");
  const [meses, setMeses] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<"marca" | "modelo" | "proveedor">("marca");
  const [metric, setMetric] = useState<"total_fob_dolars" | "total_unidades">("total_fob_dolars");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [options, setOptions] = useState<{ marca: string; modelo: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [pivot, setPivot] = useState<PivotResult | null>(null);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => {
        setCategories(d.categories ?? []);
        if (d.categories?.[0]) setSlug(d.categories[0].slug);
      });
  }, []);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    const params = new URLSearchParams({ category: slug });
    for (const m of marcas) params.append("marca", m);
    if (modelo) params.set("modelo", modelo);
    fetch(`/api/evolution?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setSeries(d.series ?? []);
        setOptions(d.options ?? []);
      })
      .finally(() => setLoading(false));
  }, [slug, marcas, modelo]);

  const marcaOptions = Array.from(new Set(options.map((o) => o.marca).filter(Boolean))) as string[];
  const modelos = Array.from(new Set(options.map((o) => o.modelo).filter(Boolean))) as string[];
  const mesOptions = useMemo(
    () => Array.from(new Set(series.map((s) => s.period))).sort().reverse(),
    [series]
  );

  // Los meses seleccionados solo filtran lo que se ve en el grafico/tabla;
  // los totales de "ultimo mes"/"ultimos 12 meses" siempre usan la serie
  // completa (sin el filtro de mes), para que no cambien de significado.
  const filteredSeries = useMemo(
    () => (meses.length > 0 ? series.filter((s) => meses.includes(s.period)) : series),
    [series, meses]
  );

  const periodInfo = useMemo(() => {
    const distinctPeriods = Array.from(new Set(series.map((s) => s.period))).sort();
    if (distinctPeriods.length === 0) return { lastPeriod: null as string | null, lastSet: null, last12Set: null, last12Count: 0 };
    const lastPeriod = distinctPeriods[distinctPeriods.length - 1];
    const last12 = distinctPeriods.slice(-12);
    return {
      lastPeriod,
      lastSet: new Set([lastPeriod]),
      last12Set: new Set(last12),
      last12Count: last12.length,
    };
  }, [series]);

  // ---- Totales de encabezado: ultimo mes y ultimos 12 meses moviles (ambas metricas siempre) ----
  const totals = useMemo(() => {
    const lastMonth = { fob: 0, unidades: 0 };
    const last12 = { fob: 0, unidades: 0 };
    for (const s of series) {
      const fob = Number(s.total_fob_dolars) || 0;
      const uni = Number(s.total_unidades) || 0;
      if (periodInfo.lastSet?.has(s.period)) {
        lastMonth.fob += fob;
        lastMonth.unidades += uni;
      }
      if (periodInfo.last12Set?.has(s.period)) {
        last12.fob += fob;
        last12.unidades += uni;
      }
    }
    return { lastPeriod: periodInfo.lastPeriod, lastMonth, last12, last12Count: periodInfo.last12Count };
  }, [series, periodInfo]);

  // ---- Top importador / marca / modelo (ultimo mes y ultimos 12 meses) ----
  const topImporter = useMemo(
    () => ({
      lastMonth: computeTop(series, periodInfo.lastSet, "proveedor"),
      last12: computeTop(series, periodInfo.last12Set, "proveedor"),
    }),
    [series, periodInfo]
  );
  const topBrand = useMemo(
    () => ({
      lastMonth: computeTop(series, periodInfo.lastSet, "marca"),
      last12: computeTop(series, periodInfo.last12Set, "marca"),
    }),
    [series, periodInfo]
  );
  const topModel = useMemo(
    () => ({
      lastMonth: computeTop(series, periodInfo.lastSet, "modelo"),
      last12: computeTop(series, periodInfo.last12Set, "modelo"),
    }),
    [series, periodInfo]
  );

  // ---- Descarga CSV de la tabla mes a mes (mismo orden que se ve en pantalla) ----
  const downloadCsv = () => {
    if (!pivot) return;
    const rowsDesc = [...pivot.rows].sort((a, b) => (a.period < b.period ? 1 : -1));
    const header = ["Periodo", ...pivot.keys].join(";");
    const lines = rowsDesc.map((row) => {
      const cells = [formatPeriod(row.period), ...pivot.keys.map((k) => Math.round(Number(row[k] ?? 0)))];
      return cells.join(";");
    });
    const totalsRow = [
      "Total",
      ...pivot.keys.map((k) => Math.round(rowsDesc.reduce((acc, row) => acc + Number(row[k] ?? 0), 0))),
    ];
    const csv = [header, ...lines, totalsRow.join(";")].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}_${groupBy}_${metric}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container">
      <h1>IA40 — Evolucion mensual por categoria</h1>
      <h2>Datos sincronizados desde Cobus Group, agregados por marca / modelo / proveedor.</h2>
      <p style={{ marginTop: -8, marginBottom: 20 }}>
        <a href="/admin" style={{ color: "var(--accent)" }}>Cargar/editar marcas por importador →</a>
      </p>

      <div className="panel row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <label>Categoria</label>
          <select value={slug} onChange={(e) => { setSlug(e.target.value); setMarcas([]); setModelo(""); setMeses([]); }}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>

        <MultiSelectDropdown
          label="Marca"
          options={marcaOptions.map((m) => ({ value: m, label: m }))}
          selected={marcas}
          onChange={setMarcas}
          placeholder="Todas"
        />

        <div>
          <label>Modelo</label>
          <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
            <option value="">Todos</option>
            {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <MultiSelectDropdown
          label="Meses"
          options={mesOptions.map((p) => ({ value: p, label: formatPeriod(p) }))}
          selected={meses}
          onChange={setMeses}
          placeholder="Todos"
          searchable={false}
        />

        <div>
          <label>Agrupar por</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
            <option value="marca">Marca</option>
            <option value="modelo">Modelo</option>
            <option value="proveedor">Proveedor</option>
          </select>
        </div>
        <div>
          <label>Metrica (grafico y tabla)</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value as any)}>
            <option value="total_fob_dolars">FOB USD</option>
            <option value="total_unidades">Unidades</option>
          </select>
        </div>
      </div>

      <div className="panel row" style={{ gap: 32 }}>
        <div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Ultimo mes{totals.lastPeriod ? ` (${formatPeriod(totals.lastPeriod)})` : ""}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {fmtNumber(totals.lastMonth.fob)} <span style={{ fontSize: 13, color: "var(--muted)" }}>USD FOB</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {fmtNumber(totals.lastMonth.unidades)} <span style={{ fontSize: 13, color: "var(--muted)" }}>Unidades</span>
          </div>
        </div>
        <div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Ultimos {totals.last12Count || 12} meses
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {fmtNumber(totals.last12.fob)} <span style={{ fontSize: 13, color: "var(--muted)" }}>USD FOB</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {fmtNumber(totals.last12.unidades)} <span style={{ fontSize: 13, color: "var(--muted)" }}>Unidades</span>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <TopCard title="Top Importador" lastMonth={topImporter.lastMonth} last12={topImporter.last12} last12Label={`Ultimos ${totals.last12Count || 12} meses`} />
        <TopCard title="Top Marca" lastMonth={topBrand.lastMonth} last12={topBrand.last12} last12Label={`Ultimos ${totals.last12Count || 12} meses`} />
        <TopCard title="Top Modelo" lastMonth={topModel.lastMonth} last12={topModel.last12} last12Label={`Ultimos ${totals.last12Count || 12} meses`} />
      </div>

      <div className="panel">
        {loading ? <p style={{ color: "var(--muted)" }}>Cargando...</p> : (
          <EvolutionChart data={filteredSeries} groupBy={groupBy} metric={metric} topN={9} onPivotChange={setPivot} />
        )}
      </div>

      {pivot && pivot.rows.length > 0 && (
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h1 style={{ fontSize: 16, margin: 0 }}>Detalle mes a mes</h1>
            <button onClick={downloadCsv}>Descargar CSV</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Periodo</th>
                  {pivot.keys.map((k) => <th key={k}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...pivot.rows]
                  .sort((a, b) => (a.period < b.period ? 1 : -1))
                  .map((row) => (
                    <tr key={row.period}>
                      <td>{formatPeriod(row.period)}</td>
                      {pivot.keys.map((k) => <td key={k}>{fmtNumber(Number(row[k] ?? 0))}</td>)}
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border, #2a2e37)" }}>
                  <td>Total</td>
                  {pivot.keys.map((k) => (
                    <td key={k}>{fmtNumber(pivot.rows.reduce((acc, row) => acc + Number(row[k] ?? 0), 0))}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Los datos se actualizan una vez por dia via /api/sync (Vercel Cron).
        Si una categoria no tiene marca/modelo mapeados todavia, esas columnas
        aparecen como "sin_dato" hasta cargar el mapeo en field_mappings.
      </p>
    </div>
  );
}
