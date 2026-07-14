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

interface ShareRow {
  key: string;
  fob: number;
  fobPct: number;
  unidades: number;
  unidadesPct: number;
}

function computeShareTable(
  series: SeriesPoint[],
  periodSet: Set<string> | null,
  dimension: "proveedor" | "marca"
): ShareRow[] {
  const totals = new Map<string, { fob: number; uni: number }>();
  let totalFob = 0;
  let totalUni = 0;
  for (const s of series) {
    if (periodSet && !periodSet.has(s.period)) continue;
    const key = ((s as any)[dimension] ?? "sin_dato") as string;
    const fob = Number(s.total_fob_dolars) || 0;
    const uni = Number(s.total_unidades) || 0;
    const cur = totals.get(key) ?? { fob: 0, uni: 0 };
    cur.fob += fob;
    cur.uni += uni;
    totals.set(key, cur);
    totalFob += fob;
    totalUni += uni;
  }
  const rows: ShareRow[] = Array.from(totals.entries()).map(([key, v]) => ({
    key,
    fob: v.fob,
    fobPct: totalFob > 0 ? (v.fob / totalFob) * 100 : 0,
    unidades: v.uni,
    unidadesPct: totalUni > 0 ? (v.uni / totalUni) * 100 : 0,
  }));
  rows.sort((a, b) => b.fob - a.fob);
  return rows;
}

function ShareTable({ title, rows, last12Label }: { title: string; rows: ShareRow[]; last12Label: string }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 320 }}>
      <h1 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>{title}</h1>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>{last12Label}</div>
      <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th style={{ textAlign: "right" }}>FOB USD</th>
              <th style={{ textAlign: "right" }}>FOB %</th>
              <th style={{ textAlign: "right" }}>Unidades</th>
              <th style={{ textAlign: "right" }}>Unidades %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td style={{ textAlign: "right" }}>{fmtNumber(r.fob)}</td>
                <td style={{ textAlign: "right" }}>{r.fobPct.toFixed(1)}%</td>
                <td style={{ textAlign: "right" }}>{fmtNumber(r.unidades)}</td>
                <td style={{ textAlign: "right" }}>{r.unidadesPct.toFixed(1)}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)" }}>Sin datos</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ModelShareRow {
  marca: string;
  modelo: string;
  importador: string;
  fob: number;
  fobPct: number;
  unidades: number;
  unidadesPct: number;
}

export interface ModelImageEntry {
  marca: string;
  modelo: string;
  image_url: string | null;
  thumbnail_url: string | null;
  source_url: string | null;
  status: string; // 'pending' | 'found' | 'not_found' | 'error'
}

function modelImageKey(marca: string, modelo: string): string {
  return `${marca}|||${modelo}`;
}

/**
 * Share por combinacion marca+modelo (no por modelo solo: el mismo nombre de
 * modelo puede repetirse entre marcas distintas). Ademas de FOB%/Unidades%
 * sobre el periodo elegido, calcula el importador principal de cada
 * combinacion (el que mas FOB acumulo) para mostrarlo como referencia.
 */
function computeShareByModel(series: SeriesPoint[], periodSet: Set<string> | null): ModelShareRow[] {
  interface Acc {
    marca: string;
    modelo: string;
    fob: number;
    uni: number;
    byImporter: Map<string, number>;
  }
  const totals = new Map<string, Acc>();
  let totalFob = 0;
  let totalUni = 0;
  for (const s of series) {
    if (periodSet && !periodSet.has(s.period)) continue;
    const marca = s.marca ?? "sin_dato";
    const modelo = s.modelo ?? "sin_dato";
    const key = modelImageKey(marca, modelo);
    const fob = Number(s.total_fob_dolars) || 0;
    const uni = Number(s.total_unidades) || 0;
    const cur = totals.get(key) ?? { marca, modelo, fob: 0, uni: 0, byImporter: new Map<string, number>() };
    cur.fob += fob;
    cur.uni += uni;
    const prov = s.proveedor ?? "sin_dato";
    cur.byImporter.set(prov, (cur.byImporter.get(prov) ?? 0) + fob);
    totals.set(key, cur);
    totalFob += fob;
    totalUni += uni;
  }

  const rows: ModelShareRow[] = Array.from(totals.values()).map((v) => {
    let importador = "-";
    let topVal = -Infinity;
    for (const [imp, val] of v.byImporter) {
      if (val > topVal) {
        topVal = val;
        importador = imp;
      }
    }
    return {
      marca: v.marca,
      modelo: v.modelo,
      importador,
      fob: v.fob,
      fobPct: totalFob > 0 ? (v.fob / totalFob) * 100 : 0,
      unidades: v.uni,
      unidadesPct: totalUni > 0 ? (v.uni / totalUni) * 100 : 0,
    };
  });
  rows.sort((a, b) => b.fob - a.fob);
  return rows;
}

const IMAGE_BUTTON_LABEL: Record<string, string> = {
  found: "Ver imagen",
  not_found: "Sin imagen",
  error: "Reintentar",
  // "pending" = todavia no se busco: el click dispara la busqueda on-demand
  // (ver ModelImageModal), no hace falta un backfill previo.
  pending: "Ver imagen",
};

function ModelShareTable({
  rows,
  last12Label,
  imageStatus,
  onViewImage,
}: {
  rows: ModelShareRow[];
  last12Label: string;
  imageStatus: (marca: string, modelo: string) => string;
  onViewImage: (marca: string, modelo: string) => void;
}) {
  return (
    <div className="panel">
      <h1 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>Share por Modelo</h1>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>{last12Label}</div>
      <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Marca</th>
              <th>Importador</th>
              <th style={{ textAlign: "right" }}>FOB USD</th>
              <th style={{ textAlign: "right" }}>FOB %</th>
              <th style={{ textAlign: "right" }}>Unidades</th>
              <th style={{ textAlign: "right" }}>Unidades %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = imageStatus(r.marca, r.modelo);
              return (
                <tr key={modelImageKey(r.marca, r.modelo)}>
                  <td>{r.modelo}</td>
                  <td>{r.marca}</td>
                  <td>{r.importador}</td>
                  <td style={{ textAlign: "right" }}>{fmtNumber(r.fob)}</td>
                  <td style={{ textAlign: "right" }}>{r.fobPct.toFixed(1)}%</td>
                  <td style={{ textAlign: "right" }}>{fmtNumber(r.unidades)}</td>
                  <td style={{ textAlign: "right" }}>{r.unidadesPct.toFixed(1)}%</td>
                  <td>
                    <button
                      onClick={() => onViewImage(r.marca, r.modelo)}
                      style={{ fontSize: 12, padding: "3px 8px", whiteSpace: "nowrap" }}
                    >
                      {IMAGE_BUTTON_LABEL[status] ?? "Pendiente"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ color: "var(--muted)" }}>Sin datos</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModelImageModal({
  marca,
  modelo,
  categorySlug,
  entry,
  onClose,
  onResolved,
}: {
  marca: string;
  modelo: string;
  categorySlug: string;
  entry: ModelImageEntry | undefined;
  onClose: () => void;
  onResolved: (entry: ModelImageEntry) => void;
}) {
  const [local, setLocal] = useState<ModelImageEntry | undefined>(entry);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setLocal(entry);
    const needsSearch = !entry || entry.status === "pending" || entry.status === "error";
    if (!needsSearch) return;

    let cancelled = false;
    setSearching(true);
    fetch("/api/model-images/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: categorySlug, marca, modelo }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.image) {
          setLocal(d.image);
          onResolved(d.image);
        }
      })
      .catch(() => {
        if (cancelled) return;
        const errEntry: ModelImageEntry = { marca, modelo, image_url: null, thumbnail_url: null, source_url: null, status: "error" };
        setLocal(errEntry);
        onResolved(errEntry);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marca, modelo, categorySlug]);

  const status = searching ? "searching" : local?.status ?? "pending";
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel, #171a21)",
          border: "1px solid var(--border, #2a2e37)",
          borderRadius: 10,
          padding: 20,
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>{marca} — {modelo}</strong>
          <button onClick={onClose} style={{ padding: "4px 10px", fontSize: 13 }}>Cerrar</button>
        </div>

        {status === "searching" && (
          <p style={{ color: "var(--muted)" }}>Buscando imagen...</p>
        )}
        {status === "not_found" && (
          <p style={{ color: "var(--muted)" }}>No se encontro una imagen representativa para este modelo.</p>
        )}
        {status === "error" && (
          <p style={{ color: "var(--muted)" }}>
            Hubo un error buscando esta imagen (puede ser cuota mensual de SerpApi agotada). Cerra y
            proba "Reintentar" mas tarde.
          </p>
        )}
        {status === "found" && local?.image_url && (
          <>
            <img
              src={local.image_url}
              alt={`${marca} ${modelo}`}
              style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 6 }}
            />
            {local.source_url && (
              <p style={{ marginTop: 10 }}>
                <a href={local.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 13 }}>
                  Ver fuente original →
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TopCard({ title, lastMonth, last12, last12Label }: {
  title: string;
  lastMonth: { topFob: TopEntry | null; topUnidades: TopEntry | null };
  last12: { topFob: TopEntry | null; topUnidades: TopEntry | null };
  last12Label: string;
}) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 260 }}>
      <h1 style={{ fontSize: 15, marginTop: 0, marginBottom: 14 }}>{title}</h1>

      <div style={{ background: "var(--bg, #0f1115)", border: "1px solid var(--border, #2a2e37)", borderRadius: 8, padding: 12, marginBottom: 10, minHeight: 132, boxSizing: "border-box" }}>
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>FOB USD</div>
        <div style={{ fontSize: 14, marginBottom: 4 }}>
          <span style={{ color: "var(--muted)" }}>Ultimo mes: </span>
          <strong>{lastMonth.topFob?.key ?? "-"}</strong>
          {lastMonth.topFob && <span style={{ color: "var(--muted)" }}> — {fmtNumber(lastMonth.topFob.value)} USD</span>}
        </div>
        <div style={{ fontSize: 14 }}>
          <span style={{ color: "var(--muted)" }}>{last12Label}: </span>
          <strong>{last12.topFob?.key ?? "-"}</strong>
          {last12.topFob && <span style={{ color: "var(--muted)" }}> — {fmtNumber(last12.topFob.value)} USD</span>}
        </div>
      </div>

      <div style={{ background: "var(--bg, #0f1115)", border: "1px solid var(--border, #2a2e37)", borderRadius: 8, padding: 12, minHeight: 132, boxSizing: "border-box" }}>
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>Unidades</div>
        <div style={{ fontSize: 14, marginBottom: 4 }}>
          <span style={{ color: "var(--muted)" }}>Ultimo mes: </span>
          <strong>{lastMonth.topUnidades?.key ?? "-"}</strong>
          {lastMonth.topUnidades && <span style={{ color: "var(--muted)" }}> — {fmtNumber(lastMonth.topUnidades.value)} un.</span>}
        </div>
        <div style={{ fontSize: 14 }}>
          <span style={{ color: "var(--muted)" }}>{last12Label}: </span>
          <strong>{last12.topUnidades?.key ?? "-"}</strong>
          {last12.topUnidades && <span style={{ color: "var(--muted)" }}> — {fmtNumber(last12.topUnidades.value)} un.</span>}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [slug, setSlug] = useState<string>("");
  const [marcas, setMarcas] = useState<string[]>([]);
  const [modelo, setModelo] = useState<string>("");
  const [importadores, setImportadores] = useState<string[]>([]);
  const [meses, setMeses] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<"marca" | "modelo" | "proveedor">("marca");
  const [metric, setMetric] = useState<"total_fob_dolars" | "total_unidades">("total_fob_dolars");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [options, setOptions] = useState<{ marca: string; modelo: string }[]>([]);
  const [importerOptions, setImporterOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pivot, setPivot] = useState<PivotResult | null>(null);
  const [modelImages, setModelImages] = useState<Map<string, ModelImageEntry>>(new Map());
  const [viewingModel, setViewingModel] = useState<{ marca: string; modelo: string } | null>(null);

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
    for (const i of importadores) params.append("importador", i);
    if (modelo) params.set("modelo", modelo);
    fetch(`/api/evolution?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setSeries(d.series ?? []);
        setOptions(d.options ?? []);
        setImporterOptions(d.importerOptions ?? []);
      })
      .finally(() => setLoading(false));
  }, [slug, marcas, modelo, importadores]);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/model-images?category=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => {
        const map = new Map<string, ModelImageEntry>();
        for (const row of (d.images ?? []) as ModelImageEntry[]) {
          map.set(modelImageKey(row.marca, row.modelo), row);
        }
        setModelImages(map);
      })
      .catch(() => setModelImages(new Map()));
  }, [slug]);

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

  // ---- Share por Importador y por Marca, ultimos 12 meses moviles ----
  const shareByImporter = useMemo(
    () => computeShareTable(series, periodInfo.last12Set, "proveedor"),
    [series, periodInfo]
  );
  const shareByBrand = useMemo(
    () => computeShareTable(series, periodInfo.last12Set, "marca"),
    [series, periodInfo]
  );
  const shareByModel = useMemo(
    () => computeShareByModel(series, periodInfo.last12Set),
    [series, periodInfo]
  );

  const imageStatusFor = (marca: string, modelo: string) =>
    modelImages.get(modelImageKey(marca, modelo))?.status ?? "pending";

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

  const filterFieldStyle: React.CSSProperties = { minWidth: 170, width: 170 };

  return (
    <div className="container">
      <h1>IA40 — Evolucion mensual por categoria</h1>
      <h2>Datos sincronizados desde Cobus Group, agregados por marca / modelo / proveedor.</h2>
      <p style={{ marginTop: -8, marginBottom: 20 }}>
        <a href="/admin" style={{ color: "var(--accent)" }}>Cargar/editar marcas por importador →</a>
      </p>

      <div className="panel row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div style={filterFieldStyle}>
          <label>Categoria</label>
          <select
            style={{ width: "100%" }}
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setMarcas([]); setModelo(""); setMeses([]); setImportadores([]); }}
          >
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>

        <div style={filterFieldStyle}>
          <MultiSelectDropdown
            label="Marca"
            options={marcaOptions.map((m) => ({ value: m, label: m }))}
            selected={marcas}
            onChange={setMarcas}
            placeholder="Todas"
          />
        </div>

        <div style={filterFieldStyle}>
          <MultiSelectDropdown
            label="Importador"
            options={importerOptions.map((p) => ({ value: p, label: p }))}
            selected={importadores}
            onChange={setImportadores}
            placeholder="Todos"
          />
        </div>

        <div style={filterFieldStyle}>
          <label>Modelo</label>
          <select style={{ width: "100%" }} value={modelo} onChange={(e) => setModelo(e.target.value)}>
            <option value="">Todos</option>
            {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={filterFieldStyle}>
          <MultiSelectDropdown
            label="Meses"
            options={mesOptions.map((p) => ({ value: p, label: formatPeriod(p) }))}
            selected={meses}
            onChange={setMeses}
            placeholder="Todos"
            searchable={false}
          />
        </div>

        <div style={filterFieldStyle}>
          <label>Agrupar por</label>
          <select style={{ width: "100%" }} value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
            <option value="marca">Marca</option>
            <option value="modelo">Modelo</option>
            <option value="proveedor">Proveedor</option>
          </select>
        </div>
        <div style={filterFieldStyle}>
          <label>Metrica (grafico y tabla)</label>
          <select style={{ width: "100%" }} value={metric} onChange={(e) => setMetric(e.target.value as any)}>
            <option value="total_fob_dolars">FOB USD</option>
            <option value="total_unidades">Unidades</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ gap: 16 }}>
        <div className="panel" style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 8 }}>
            Ultimo mes{totals.lastPeriod ? ` (${formatPeriod(totals.lastPeriod)})` : ""}
          </div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>
            {fmtNumber(totals.lastMonth.fob)} <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>USD FOB</span>
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 6 }}>
            {fmtNumber(totals.lastMonth.unidades)} <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>Unidades</span>
          </div>
        </div>
        <div className="panel" style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 8 }}>
            Ultimos {totals.last12Count || 12} meses
          </div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>
            {fmtNumber(totals.last12.fob)} <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>USD FOB</span>
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 6 }}>
            {fmtNumber(totals.last12.unidades)} <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>Unidades</span>
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
          <EvolutionChart
            data={filteredSeries}
            groupBy={groupBy}
            metric={metric}
            topN={9}
            pinnedKeys={groupBy === "marca" ? ["Mugi", "Magesa"] : []}
            onPivotChange={setPivot}
          />
        )}
      </div>

      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <ShareTable
          title="Share por Importador"
          rows={shareByImporter}
          last12Label={`Ultimos ${totals.last12Count || 12} meses moviles`}
        />
        <ShareTable
          title="Share por Marca"
          rows={shareByBrand}
          last12Label={`Ultimos ${totals.last12Count || 12} meses moviles`}
        />
      </div>

      <ModelShareTable
        rows={shareByModel}
        last12Label={`Ultimos ${totals.last12Count || 12} meses moviles`}
        imageStatus={imageStatusFor}
        onViewImage={(marca, modelo) => setViewingModel({ marca, modelo })}
      />

      {viewingModel && (
        <ModelImageModal
          marca={viewingModel.marca}
          modelo={viewingModel.modelo}
          categorySlug={slug}
          entry={modelImages.get(modelImageKey(viewingModel.marca, viewingModel.modelo))}
          onClose={() => setViewingModel(null)}
          onResolved={(img) =>
            setModelImages((prev) => {
              const next = new Map(prev);
              next.set(modelImageKey(img.marca, img.modelo), img);
              return next;
            })
          }
        />
      )}

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
