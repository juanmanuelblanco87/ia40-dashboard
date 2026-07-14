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

  // ---- Totales de encabezado: ultimo mes y ultimos 12 meses moviles (ambas metricas siempre) ----
  const totals = useMemo(() => {
    const distinctPeriods = Array.from(new Set(series.map((s) => s.period))).sort();
    if (distinctPeriods.length === 0) {
      return {
        lastPeriod: null as string | null,
        lastMonth: { fob: 0, unidades: 0 },
        last12: { fob: 0, unidades: 0 },
        last12Count: 0,
      };
    }
    const lastPeriod = distinctPeriods[distinctPeriods.length - 1];
    const last12Periods = new Set(distinctPeriods.slice(-12));

    const lastMonth = { fob: 0, unidades: 0 };
    const last12 = { fob: 0, unidades: 0 };
    for (const s of series) {
      const fob = Number(s.total_fob_dolars) || 0;
      const uni = Number(s.total_unidades) || 0;
      if (s.period === lastPeriod) {
        lastMonth.fob += fob;
        lastMonth.unidades += uni;
      }
      if (last12Periods.has(s.period)) {
        last12.fob += fob;
        last12.unidades += uni;
      }
    }
    return { lastPeriod, lastMonth, last12, last12Count: last12Periods.size };
  }, [series]);

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

  const toggleMultiSelect = (
    e: React.ChangeEvent<HTMLSelectElement>,
    setter: (v: string[]) => void
  ) => {
    const values = Array.from(e.target.selectedOptions).map((o) => o.value);
    setter(values);
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
          <select value={slug} onChange={(e) => { setSlug(e.target.value); setMarcas([]); setModelo(""); setMeses([]); }}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Marca (Ctrl+click para varias)</label>
          <select multiple value={marcas} onChange={(e) => toggleMultiSelect(e, setMarcas)} style={{ minHeight: 70 }}>
            {marcaOptions.map((m) => <option key={m} value={m}>{m}</option>)}
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
          <label>Meses (Ctrl+click para varios)</label>
          <select multiple value={meses} onChange={(e) => toggleMultiSelect(e, setMeses)} style={{ minHeight: 70 }}>
            {mesOptions.map((p) => <option key={p} value={p}>{formatPeriod(p)}</option>)}
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
