"use client";

import { useEffect, useMemo, useState } from "react";
import EvolutionChart, { SeriesPoint, PivotResult, formatPeriod, fmtNumber } from "@/components/EvolutionChart";

interface Category {
  id: number;
  slug: string;
  name: string;
  ncm_codes: string[];
}

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [slug, setSlug] = useState<string>("");
  const [marca, setMarca] = useState<string>("");
  const [modelo, setModelo] = useState<string>("");
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
    if (marca) params.set("marca", marca);
    if (modelo) params.set("modelo", modelo);
    fetch(`/api/evolution?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setSeries(d.series ?? []);
        setOptions(d.options ?? []);
      })
      .finally(() => setLoading(false));
  }, [slug, marca, modelo]);

  const marcas = Array.from(new Set(options.map((o) => o.marca).filter(Boolean))) as string[];
  const modelos = Array.from(new Set(options.map((o) => o.modelo).filter(Boolean))) as string[];

  // ---- Totales de encabezado: ultimo mes y ultimos 12 meses moviles ----
  const totals = useMemo(() => {
    const distinctPeriods = Array.from(new Set(series.map((s) => s.period))).sort();
    if (distinctPeriods.length === 0) {
      return { lastPeriod: null as string | null, lastMonthTotal: 0, last12Total: 0, last12Count: 0 };
    }
    const lastPeriod = distinctPeriods[distinctPeriods.length - 1];
    const last12Periods = new Set(distinctPeriods.slice(-12));

    let lastMonthTotal = 0;
    let last12Total = 0;
    for (const s of series) {
      const v = Number(s[metric]) || 0;
      if (s.period === lastPeriod) lastMonthTotal += v;
      if (last12Periods.has(s.period)) last12Total += v;
    }
    return { lastPeriod, lastMonthTotal, last12Total, last12Count: last12Periods.size };
  }, [series, metric]);

  const metricLabel = metric === "total_fob_dolars" ? "FOB USD" : "Unidades";

  // ---- Descarga CSV de la tabla mes a mes ----
  const downloadCsv = () => {
    if (!pivot) return;
    const header = ["Periodo", ...pivot.keys].join(";");
    const lines = pivot.rows.map((row) => {
      const cells = [formatPeriod(row.period), ...pivot.keys.map((k) => Math.round(Number(row[k] ?? 0)))];
      return cells.join(";");
    });
    const csv = [header, ...lines].join("\n");
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

      <div className="panel row">
        <div>
          <label>Categoria</label>
          <select value={slug} onChange={(e) => { setSlug(e.target.value); setMarca(""); setModelo(""); }}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Marca</label>
          <select value={marca} onChange={(e) => setMarca(e.target.value)}>
            <option value="">Todas</option>
            {marcas.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label>Modelo</label>
          <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
            <option value="">Todos</option>
            {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label>Agrupar por</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
            <option value="marca">Marca</option>
            <option value="modelo">Modelo</option>
            <option value="proveedor">Proveedor</option>
          </select>
        </div>
        <div>
          <label>Metrica</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value as any)}>
            <option value="total_fob_dolars">FOB USD</option>
            <option value="total_unidades">Unidades</option>
          </select>
        </div>
      </div>

      <div className="panel row" style={{ gap: 24 }}>
        <div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Ultimo mes{totals.lastPeriod ? ` (${formatPeriod(totals.lastPeriod)})` : ""}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {fmtNumber(totals.lastMonthTotal)} <span style={{ fontSize: 14, color: "var(--muted)" }}>{metricLabel}</span>
          </div>
        </div>
        <div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Ultimos {totals.last12Count || 12} meses
          </div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {fmtNumber(totals.last12Total)} <span style={{ fontSize: 14, color: "var(--muted)" }}>{metricLabel}</span>
          </div>
        </div>
      </div>

      <div className="panel">
        {loading ? <p style={{ color: "var(--muted)" }}>Cargando...</p> : (
          <EvolutionChart data={series} groupBy={groupBy} metric={metric} topN={9} onPivotChange={setPivot} />
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
                {pivot.rows.map((row) => (
                  <tr key={row.period}>
                    <td>{formatPeriod(row.period)}</td>
                    {pivot.keys.map((k) => <td key={k}>{fmtNumber(Number(row[k] ?? 0))}</td>)}
                  </tr>
                ))}
              </tbody>
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
