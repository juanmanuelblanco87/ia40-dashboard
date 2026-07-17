"use client";

import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import EvolutionChart, { SeriesPoint, PivotResult, formatPeriod, fmtNumber } from "@/components/EvolutionChart";
import MultiSelectDropdown from "@/components/MultiSelectDropdown";
import { segmentosValidos } from "@/lib/segmentos";

// Colores fijos para los 6 segmentos originales de "Sillas de Ruedas" (se
// mantienen para no cambiar los colores ya conocidos de esa categoria).
// Para las demas categorias (cada una con sus propios nombres de segmento,
// ver lib/segmentos.ts) se asigna un color de forma deterministica desde
// SEGMENTO_PALETTE en base al nombre del segmento -- asi ningun segmento
// queda sin color asignado (bug anterior: todo caia a un gris de fallback).
const SEGMENTO_COLORS: Record<string, string> = {
  "Silla Estándar": "#2f6fe0",
  "Silla Ultra Livianas": "#1f9e63",
  "Sillas Infantiles": "#e8722f",
  "Silla Postural": "#9b30d9",
  "Silla Activa y Deportivas": "#d93a3a",
  "Silla de Traslado": "#1aa8c9",
};
const SEGMENTO_PALETTE = [
  "#2f6fe0",
  "#1f9e63",
  "#e8722f",
  "#9b30d9",
  "#d93a3a",
  "#1aa8c9",
  "#c9a227",
  "#5f6b7a",
  "#e0507a",
  "#3ab795",
  "#f2994a",
  "#7d5ba6",
];
function colorForSegmento(key: string): string {
  const fijo = SEGMENTO_COLORS[key];
  if (fijo) return fijo;
  // Hash simple y estable del nombre -> siempre el mismo color para el
  // mismo segmento, sin depender del orden en que aparecen las filas.
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return SEGMENTO_PALETTE[hash % SEGMENTO_PALETTE.length];
}

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
  dimension: "proveedor" | "marca" | "segmento"
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

function ShareTable({
  title,
  rows,
  last12Label,
  nameLabel = "Nombre",
}: {
  title: string;
  rows: ShareRow[];
  last12Label: string;
  nameLabel?: string;
}) {
  return (
    <div className="panel">
      <h1 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>{title}</h1>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>{last12Label}</div>
      <div className="table-scroll" style={{ maxHeight: 360, overflowY: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{nameLabel}</th>
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

function SegmentoPieChart({ rows, last12Label }: { rows: ShareRow[]; last12Label: string }) {
  return (
    <div className="panel">
      <h1 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>Share por Segmento (FOB)</h1>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>{last12Label}</div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Sin datos.</p>
      ) : (
        <div className="pie-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="fob"
              nameKey="key"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={(entry: any) => `${Number(entry.fobPct ?? 0).toFixed(0)}%`}
            >
              {rows.map((r) => (
                <Cell key={r.key} fill={colorForSegmento(r.key)} />
              ))}
            </Pie>
            <Tooltip formatter={(value: any) => fmtNumber(Number(value))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface ModelShareRow {
  marca: string;
  modelo: string;
  segmento: string;
  importador: string;
  fob: number;
  fobPct: number;
  unidades: number;
  unidadesPct: number;
  /** fob / unidades del periodo (0 si no hay unidades). */
  fobUnitario: number;
}

export interface ModelImageEntry {
  marca: string;
  modelo: string;
  image_url: string | null;
  thumbnail_url: string | null;
  source_url: string | null;
  status: string; // 'pending' | 'found' | 'not_found' | 'error'
}

/**
 * PVP (Precio de Venta al Publico) estimado en USD via OpenAI (busqueda web,
 * ver lib/pvpFinder.ts), cacheado en la tabla model_pvp. Se consulta ON
 * DEMAND igual que la imagen: el usuario hace click en "Consultar precio" en
 * la fila y se guarda para siempre (salvo que haya dado 'error').
 */
export interface ModelPvpEntry {
  marca: string;
  modelo: string;
  pvp_usd: number | null;
  confianza: string | null;
  fuentes_consistentes: number | null;
  razonamiento: string | null;
  fuente_url: string | null;
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
    segmento: string;
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
    const segmento = s.segmento ?? "sin_dato";
    const key = modelImageKey(marca, modelo);
    const fob = Number(s.total_fob_dolars) || 0;
    const uni = Number(s.total_unidades) || 0;
    const cur = totals.get(key) ?? { marca, modelo, segmento, fob: 0, uni: 0, byImporter: new Map<string, number>() };
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
      segmento: v.segmento,
      importador,
      fob: v.fob,
      fobPct: totalFob > 0 ? (v.fob / totalFob) * 100 : 0,
      unidades: v.uni,
      unidadesPct: totalUni > 0 ? (v.uni / totalUni) * 100 : 0,
      fobUnitario: v.uni > 0 ? v.fob / v.uni : 0,
    };
  });
  rows.sort((a, b) => b.fob - a.fob);
  return rows;
}

// Titulo (tooltip) del boton de imagen -- el boton en si se ve como un
// icono de lupa para no ocupar tanto lugar en la tabla (ver ModelShareTable).
const IMAGE_BUTTON_LABEL: Record<string, string> = {
  found: "Ver imagen",
  not_found: "Sin imagen (click para reintentar)",
  error: "Reintentar busqueda de imagen",
  // "pending" = todavia no se busco: el click dispara la busqueda on-demand
  // (ver ModelImageModal), no hace falta un backfill previo.
  pending: "Buscar imagen",
};

const PVP_BUTTON_LABEL: Record<string, string> = {
  not_found: "No se encontro un precio confiable (click para reintentar)",
  error: "Reintentar consulta de precio",
  pending: "Consultar precio (OpenAI busca en la web)",
};

function ModelShareTable({
  rows,
  last12Label,
  imageStatus,
  onViewImage,
  pvpEntry,
  pvpLoadingKeys,
  onConsultPvp,
}: {
  rows: ModelShareRow[];
  last12Label: string;
  imageStatus: (marca: string, modelo: string) => string;
  onViewImage: (marca: string, modelo: string, segmento: string) => void;
  pvpEntry: (marca: string, modelo: string) => ModelPvpEntry | undefined;
  pvpLoadingKeys: Set<string>;
  onConsultPvp: (marca: string, modelo: string, segmento: string) => void;
}) {
  const cellStyle: React.CSSProperties = { padding: "5px 6px", fontSize: 12.5 };
  const cellRight: React.CSSProperties = { ...cellStyle, textAlign: "right" };
  return (
    <div className="panel">
      <h1 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>Share por Modelo</h1>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>{last12Label}</div>
      <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
        <table className="admin-table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={cellStyle}>Modelo</th>
              <th style={cellStyle}>Marca</th>
              <th style={cellStyle}>Segmento</th>
              <th style={cellStyle}>Importador</th>
              <th style={cellRight}>FOB USD</th>
              <th style={cellRight}>FOB %</th>
              <th style={cellRight}>Unidades</th>
              <th style={cellRight}>Uds %</th>
              <th style={cellRight}>FOB Unit.</th>
              <th style={cellRight}>PVP USD</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = imageStatus(r.marca, r.modelo);
              const key = modelImageKey(r.marca, r.modelo);
              const pvp = pvpEntry(r.marca, r.modelo);
              const pvpStatus = pvp?.status ?? "pending";
              const pvpLoading = pvpLoadingKeys.has(key);
              return (
                <tr key={key}>
                  <td style={cellStyle}>{r.modelo}</td>
                  <td style={cellStyle}>{r.marca}</td>
                  <td style={cellStyle}>{r.segmento}</td>
                  <td style={cellStyle}>{r.importador}</td>
                  <td style={cellRight}>{fmtNumber(r.fob)}</td>
                  <td style={cellRight}>{r.fobPct.toFixed(1)}%</td>
                  <td style={cellRight}>{fmtNumber(r.unidades)}</td>
                  <td style={cellRight}>{r.unidadesPct.toFixed(1)}%</td>
                  <td style={cellRight}>{r.unidades > 0 ? `$${fmtNumber(r.fobUnitario)}` : "-"}</td>
                  <td style={cellRight}>
                    {pvpLoading ? (
                      <span style={{ color: "var(--muted)" }}>Buscando...</span>
                    ) : pvpStatus === "found" && pvp?.pvp_usd != null ? (
                      pvp.fuente_url ? (
                        <a
                          href={pvp.fuente_url}
                          target="_blank"
                          rel="noreferrer"
                          title={pvp.razonamiento ?? "Ver publicacion de origen"}
                          style={{ color: "var(--accent)" }}
                        >
                          ${fmtNumber(pvp.pvp_usd)}
                        </a>
                      ) : (
                        <span title={pvp.razonamiento ?? undefined}>${fmtNumber(pvp.pvp_usd)}</span>
                      )
                    ) : (
                      <button
                        onClick={() => onConsultPvp(r.marca, r.modelo, r.segmento)}
                        title={PVP_BUTTON_LABEL[pvpStatus] ?? "Consultar precio"}
                        style={{ fontSize: 11, padding: "2px 6px", whiteSpace: "nowrap" }}
                      >
                        {pvpStatus === "not_found" ? "Sin dato ↻" : pvpStatus === "error" ? "Error ↻" : "Consultar"}
                      </button>
                    )}
                  </td>
                  <td style={cellStyle}>
                    <button
                      onClick={() => onViewImage(r.marca, r.modelo, r.segmento)}
                      title={IMAGE_BUTTON_LABEL[status] ?? "Buscar imagen"}
                      aria-label={IMAGE_BUTTON_LABEL[status] ?? "Buscar imagen"}
                      style={{ fontSize: 13, padding: "2px 7px", lineHeight: 1 }}
                    >
                      🔍
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} style={{ color: "var(--muted)" }}>Sin datos</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// NOTA (17/07/2026): las opciones del <select> de Segmento en el modal de
// correccion ("Corregir") ya NO son una lista fija -- vienen de
// segmentosValidos(categorySlug) (lib/segmentos.ts), que tiene una lista
// distinta por categoria. Antes esto solo mostraba (y el backend solo
// aceptaba) los 6 segmentos de "Sillas de ruedas", asi que corregir el
// segmento de un andador, una cama, etc. era imposible.

function ModelImageModal({
  marca,
  modelo,
  categorySlug,
  segmentoActual,
  entry,
  onClose,
  onResolved,
  onOverrideSaved,
}: {
  marca: string;
  modelo: string;
  categorySlug: string;
  segmentoActual: string;
  entry: ModelImageEntry | undefined;
  onClose: () => void;
  onResolved: (entry: ModelImageEntry) => void;
  onOverrideSaved: () => void;
}) {
  const [local, setLocal] = useState<ModelImageEntry | undefined>(entry);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [segmentoInput, setSegmentoInput] = useState(segmentoActual);
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Si cambia la imagen (ej. se guarda una correccion nueva), se resetea el
  // estado de error para volver a intentar cargarla.
  useEffect(() => {
    setImgError(false);
  }, [local?.image_url]);

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

  const startEditing = () => {
    setImageUrlInput(local?.image_url ?? "");
    setSegmentoInput(segmentoActual);
    setEditing(true);
  };

  const saveOverride = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = { category: categorySlug, marca, modelo };
      const trimmedUrl = imageUrlInput.trim();
      if (trimmedUrl) body.image_url = trimmedUrl;
      if (segmentoInput) body.segmento = segmentoInput;

      const res = await fetch("/api/model-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save_failed");

      if (trimmedUrl) {
        const updated: ModelImageEntry = {
          marca,
          modelo,
          image_url: trimmedUrl,
          thumbnail_url: trimmedUrl,
          source_url: local?.source_url ?? null,
          status: "found",
        };
        setLocal(updated);
        onResolved(updated);
      }
      setEditing(false);
      onOverrideSaved();
    } catch {
      alert("No se pudo guardar la correccion. Proba de nuevo.");
    } finally {
      setSaving(false);
    }
  };

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{marca} — {modelo}</strong>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {!editing && (
              <button onClick={startEditing} title="Corregir imagen o segmento" style={{ padding: "4px 10px", fontSize: 13 }}>
                ✎ Corregir
              </button>
            )}
            <button onClick={onClose} style={{ padding: "4px 10px", fontSize: 13 }}>Cerrar</button>
          </div>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 14 }}>Segmento: {segmentoActual}</div>

        {editing && (
          <div style={{ textAlign: "left", background: "var(--bg, #0f1115)", border: "1px solid var(--border, #2a2e37)", borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              URL de imagen (dejar vacio para no cambiarla)
            </label>
            <input
              type="text"
              value={imageUrlInput}
              onChange={(e) => setImageUrlInput(e.target.value)}
              placeholder="https://..."
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 13, marginBottom: 12 }}
            />
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Segmento
            </label>
            <select
              value={segmentoInput}
              onChange={(e) => setSegmentoInput(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", fontSize: 13, marginBottom: 14 }}
            >
              {segmentosValidos(categorySlug).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditing(false)} disabled={saving} style={{ padding: "4px 10px", fontSize: 13 }}>
                Cancelar
              </button>
              <button onClick={saveOverride} disabled={saving} style={{ padding: "4px 10px", fontSize: 13 }}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        )}

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
        {status === "found" && local?.image_url && !imgError && (
          <>
            <img
              src={local.image_url}
              alt={`${marca} ${modelo}`}
              onError={() => setImgError(true)}
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
        {status === "found" && local?.image_url && imgError && (
          <p style={{ color: "var(--muted)" }}>
            No se pudo cargar la imagen desde ese link. Probablemente pegaste la URL de la <em>pagina</em> del
            producto en vez de la URL directa de la imagen (que tiene que terminar en algo como .jpg, .png o
            .webp). Para conseguirla: abri la pagina del producto, click derecho sobre la imagen y elegi
            "Copiar direccion de la imagen" (o "Copy image address"), y pega eso con "✎ Corregir".
          </p>
        )}
      </div>
    </div>
  );
}

function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icomsalud-teal.png" alt="Icom Salud" className="app-header-logo" />
        <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.25)" }} />
        <div className="app-header-title">Módulo de Importaciones</div>
      </div>
    </header>
  );
}

function TopCard({ title, lastMonth, last12, last12Label }: {
  title: string;
  lastMonth: { topFob: TopEntry | null; topUnidades: TopEntry | null };
  last12: { topFob: TopEntry | null; topUnidades: TopEntry | null };
  last12Label: string;
}) {
  return (
    <div className="panel">
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

// Para categorias cuya NCM trae de fondo mucha data no-medica (ver
// docs/PROYECTO.md, parser de cada categoria), el filtro de Segmento
// arranca preseleccionado en el segmento de uso ortopedico/relevante que
// nos interesa, en vez de mostrar TODO desde el arranque. Los datos de los
// demas segmentos NO se pierden ni se descartan (siguen sincronizados) --
// el usuario puede ampliar o cambiar la seleccion de Segmento en cualquier
// momento para verlos.
interface SieveSummary {
  categoria?: string;
  solicitados?: number;
  procesados?: number;
  sin_cambios?: number;
  segmento_corregido?: number;
  categoria_movida?: number;
  sin_evidencia?: number;
  errores?: number;
  /** Cuantos items trajeron un PVP nuevo en esta corrida (ver sección 10.2). */
  pvp_actualizado?: number;
  movidos?: { marca: string; modelo: string; de: string; a: string; segmento: string | null; razonamiento: string }[];
  corregidos?: { marca: string; modelo: string; segmento: string; razonamiento: string }[];
  detalle_errores?: string[];
  parcial?: boolean;
  error?: string;
}

const DEFAULT_SEGMENTO_FILTER: Record<string, string[]> = {
  sillas_ducha: ["Sillas de Ducha / Sanitarias"],
  almohadones_ortopedicos: ["Cojín Ortopédico / Antiescaras"],
  elevadores_inodoro: ["Elevador / Asiento Sanitario Ortopédico"],
};

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [slug, setSlug] = useState<string>("");
  const [marcas, setMarcas] = useState<string[]>([]);
  const [modelosSel, setModelosSel] = useState<string[]>([]);
  const [importadores, setImportadores] = useState<string[]>([]);
  const [colores, setColores] = useState<string[]>([]);
  const [segmentos, setSegmentos] = useState<string[]>([]);
  const [meses, setMeses] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<"marca" | "modelo" | "proveedor">("marca");
  const [metric, setMetric] = useState<"total_fob_dolars" | "total_unidades">("total_fob_dolars");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [options, setOptions] = useState<{ marca: string; modelo: string }[]>([]);
  const [importerOptions, setImporterOptions] = useState<string[]>([]);
  const [colorOptions, setColorOptions] = useState<string[]>([]);
  const [segmentoOptions, setSegmentoOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pivot, setPivot] = useState<PivotResult | null>(null);
  const [modelImages, setModelImages] = useState<Map<string, ModelImageEntry>>(new Map());
  const [modelPvp, setModelPvp] = useState<Map<string, ModelPvpEntry>>(new Map());
  const [pvpLoadingKeys, setPvpLoadingKeys] = useState<Set<string>>(new Set());
  const [viewingModel, setViewingModel] = useState<{ marca: string; modelo: string; segmento: string } | null>(null);
  const [sieving, setSieving] = useState(false);
  const [sieveResult, setSieveResult] = useState<SieveSummary | null>(null);
  const [showSieveErrors, setShowSieveErrors] = useState(false);
  // true/false = ultimo resultado conocido de /api/evolution; null = todavia no se sabe
  const [syncOk, setSyncOk] = useState<boolean | null>(null);
  const [sieveStatus, setSieveStatus] = useState<{ total: number; tamizado: number; pendientes: number; porcentaje: number } | null>(null);
  // Segundos que tardo, en promedio, cada modelo procesado en la ULTIMA
  // corrida (busqueda + IA por modelo) -- se usa para estimar cuanto falta
  // para terminar toda la categoria (sieveStatus.pendientes * este valor).
  const [sieveSecondsPerItem, setSieveSecondsPerItem] = useState<number | null>(null);

  const reloadSieveStatus = () => {
    if (!slug) {
      setSieveStatus(null);
      return;
    }
    fetch(`/api/sieve/status?category=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => setSieveStatus(d.error ? null : d))
      .catch(() => setSieveStatus(null));
  };

  useEffect(reloadSieveStatus, [slug]);

  const runSieve = () => {
    if (!slug || sieving) return;
    setSieving(true);
    setSieveResult(null);
    setShowSieveErrors(false);
    const startedAt = Date.now();
    fetch(`/api/sieve?category=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => {
        setSieveResult(d);
        const elapsedSec = (Date.now() - startedAt) / 1000;
        const procesados = d.procesados ?? 0;
        if (procesados > 0) setSieveSecondsPerItem(elapsedSec / procesados);
        // Si se corrigieron segmentos o se movieron filas de categoria, la
        // serie actual puede haber cambiado -- se recarga para reflejarlo.
        if ((d.segmento_corregido ?? 0) > 0 || (d.categoria_movida ?? 0) > 0) reloadSeries();
        if ((d.pvp_actualizado ?? 0) > 0) reloadModelPvp();
        reloadSieveStatus();
      })
      .catch(() => setSieveResult({ error: "No se pudo correr el tamizador. Proba de nuevo." } as any))
      .finally(() => setSieving(false));
  };

  /** "125" -> "2 min 5 s"; redondea a lo mas util (segundos si es poco, minutos si es mucho). */
  function fmtDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s} s`;
    const mins = Math.round(s / 60);
    if (mins < 60) return `~${mins} min`;
    const hs = Math.floor(mins / 60);
    const restMin = mins % 60;
    return `~${hs} h ${restMin} min`;
  }

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => {
        setCategories(d.categories ?? []);
        if (d.categories?.[0]) {
          setSlug(d.categories[0].slug);
          setSegmentos(DEFAULT_SEGMENTO_FILTER[d.categories[0].slug] ?? []);
        }
      });
  }, []);

  // Extraida como funcion reusable para poder recargar la serie sin cambiar
  // filtros (ej. despues de guardar una correccion manual de segmento desde
  // el modal de imagen, sin esperar al proximo /api/sync).
  const reloadSeries = () => {
    if (!slug) return;
    setLoading(true);
    const params = new URLSearchParams({ category: slug });
    for (const m of marcas) params.append("marca", m);
    for (const i of importadores) params.append("importador", i);
    for (const m of modelosSel) params.append("modelo", m);
    for (const c of colores) params.append("color", c);
    for (const s2 of segmentos) params.append("segmento", s2);
    fetch(`/api/evolution?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error("bad_status");
        return r.json();
      })
      .then((d) => {
        setSeries(d.series ?? []);
        setOptions(d.options ?? []);
        setImporterOptions(d.importerOptions ?? []);
        setColorOptions(d.colorOptions ?? []);
        setSegmentoOptions(d.segmentoOptions ?? []);
        setSyncOk(true);
      })
      .catch(() => setSyncOk(false))
      .finally(() => setLoading(false));
  };

  useEffect(reloadSeries, [slug, marcas, modelosSel, importadores, colores, segmentos]);

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

  // Extraida en su propia funcion para poder recargarla tanto al cambiar de
  // categoria como despues de correr el tamizador (que ahora tambien
  // completa PVP en la misma busqueda, ver guardarPvp() en
  // app/api/sieve/route.ts) -- asi la columna PVP USD se actualiza sola sin
  // esperar a un cambio de categoria/refresco de pagina.
  const reloadModelPvp = () => {
    if (!slug) return;
    fetch(`/api/model-pvp?category=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => {
        const map = new Map<string, ModelPvpEntry>();
        for (const row of (d.pvps ?? []) as ModelPvpEntry[]) {
          map.set(modelImageKey(row.marca, row.modelo), row);
        }
        setModelPvp(map);
      })
      .catch(() => setModelPvp(new Map()));
  };

  useEffect(reloadModelPvp, [slug]);

  // Consulta on-demand del PVP de un modelo puntual (click en "Consultar" en
  // la columna PVP USD de Share por Modelo) -- llama a OpenAI (web_search) y
  // queda cacheado en model_pvp, igual que la busqueda de imagen.
  const handleConsultPvp = (marca: string, modelo: string, _segmento: string) => {
    const key = modelImageKey(marca, modelo);
    if (pvpLoadingKeys.has(key)) return;
    setPvpLoadingKeys((prev) => new Set(prev).add(key));
    fetch("/api/model-pvp/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: slug, marca, modelo }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.pvp) {
          setModelPvp((prev) => {
            const next = new Map(prev);
            next.set(key, d.pvp);
            return next;
          });
        }
      })
      .catch(() => {
        setModelPvp((prev) => {
          const next = new Map(prev);
          next.set(key, {
            marca,
            modelo,
            pvp_usd: null,
            confianza: null,
            fuentes_consistentes: null,
            razonamiento: null,
            fuente_url: null,
            status: "error",
          });
          return next;
        });
      })
      .finally(() => {
        setPvpLoadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  };

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
  const shareBySegmento = useMemo(
    () => computeShareTable(series, periodInfo.last12Set, "segmento"),
    [series, periodInfo]
  );

  const imageStatusFor = (marca: string, modelo: string) =>
    modelImages.get(modelImageKey(marca, modelo))?.status ?? "pending";

  const pvpEntryFor = (marca: string, modelo: string) => modelPvp.get(modelImageKey(marca, modelo));

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
    <>
      <AppHeader />
      <div className="container">
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 14, paddingBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <span>Datos sincronizados desde Cobus Group</span>
          {syncOk === true && <span title="Sincronización OK" style={{ color: "#2fa84f" }}>✓</span>}
          {syncOk === false && <span title="No se pudo cargar la información" style={{ color: "#d93a3a" }}>⚠️</span>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={runSieve} disabled={sieving || !slug}>
            {sieving ? "🔎 Tamizando..." : "🔎 Tamizar categoría"}
          </button>
          {sieveStatus && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
              <div style={{ width: 120, height: 8, background: "var(--border, #2a2e37)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${sieveStatus.porcentaje}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <span>
                {sieveStatus.tamizado}/{sieveStatus.total} tamizado ({sieveStatus.porcentaje}%)
              </span>
              {sieveSecondsPerItem != null && sieveStatus.pendientes > 0 && (
                <span>· ≈{fmtDuration(sieveStatus.pendientes * sieveSecondsPerItem)} restante</span>
              )}
            </div>
          )}
        </div>

        {sieveResult && (
          <div style={{ background: "var(--bg, #0f1115)", border: "1px solid var(--border, #2a2e37)", borderRadius: 8, padding: 12, fontSize: 13 }}>
            {sieveResult.error ? (
              <div style={{ color: "#d93a3a" }}>{sieveResult.error}</div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <strong>
                    Procesados {sieveResult.procesados ?? 0} de {sieveResult.solicitados ?? 0} pendientes
                  </strong>
                  <button onClick={() => setSieveResult(null)} style={{ padding: "2px 8px", fontSize: 12 }}>Cerrar</button>
                </div>
                <div style={{ color: "var(--muted)" }}>
                  Sin cambios: {sieveResult.sin_cambios ?? 0} · Segmento corregido: {sieveResult.segmento_corregido ?? 0} ·
                  {" "}Categoría movida: {sieveResult.categoria_movida ?? 0} · Sin evidencia: {sieveResult.sin_evidencia ?? 0}
                  {" "}· PVP encontrado: {sieveResult.pvp_actualizado ?? 0}
                  {(sieveResult.errores ?? 0) > 0 && (
                    <>
                      {" "}· Errores: {sieveResult.errores}{" "}
                      <button
                        onClick={() => setShowSieveErrors((v) => !v)}
                        style={{ padding: "1px 6px", fontSize: 11, marginLeft: 4 }}
                      >
                        {showSieveErrors ? "Ocultar errores" : "Ver errores"}
                      </button>
                    </>
                  )}
                </div>
                {sieveResult.parcial && (
                  <div style={{ color: "var(--muted)", marginTop: 6 }}>
                    ⏱️ Se alcanzó el límite de tiempo de este click antes de terminar el lote completo — lo ya
                    procesado quedó guardado. Clickeá "Tamizar categoría" de nuevo para seguir con el resto.
                  </div>
                )}
                {showSieveErrors && (sieveResult.detalle_errores?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong style={{ color: "#d93a3a" }}>Detalle de errores:</strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "#d93a3a" }}>
                      {sieveResult.detalle_errores!.slice(0, 10).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(sieveResult.movidos?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Movidos de categoría:</strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {sieveResult.movidos!.map((m, i) => (
                        <li key={i}>
                          {m.marca} — {m.modelo}: {m.de} → <strong>{m.a}</strong> ({m.segmento ?? "sin segmento"})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(sieveResult.corregidos?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Segmento corregido:</strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {sieveResult.corregidos!.map((c, i) => (
                        <li key={i}>
                          {c.marca} — {c.modelo}: {c.segmento}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="panel row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="filter-field">
          <label>🦽 Categoria</label>
          <select
            style={{ width: "100%" }}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setMarcas([]);
              setModelosSel([]);
              setMeses([]);
              setImportadores([]);
              setColores([]);
              setSegmentos(DEFAULT_SEGMENTO_FILTER[e.target.value] ?? []);
            }}
          >
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <MultiSelectDropdown
            label="🏷️ Marca"
            options={marcaOptions.map((m) => ({ value: m, label: m }))}
            selected={marcas}
            onChange={setMarcas}
            placeholder="Todas"
          />
        </div>

        <div className="filter-field">
          <MultiSelectDropdown
            label="🚚 Importador"
            options={importerOptions.map((p) => ({ value: p, label: p }))}
            selected={importadores}
            onChange={setImportadores}
            placeholder="Todos"
          />
        </div>

        <div className="filter-field">
          <MultiSelectDropdown
            label="📦 Modelo"
            options={modelos.map((m) => ({ value: m, label: m }))}
            selected={modelosSel}
            onChange={setModelosSel}
            placeholder="Todos"
          />
        </div>

        <div className="filter-field">
          <MultiSelectDropdown
            label="🎨 Color"
            options={colorOptions.map((c) => ({ value: c, label: c }))}
            selected={colores}
            onChange={setColores}
            placeholder="Todos"
          />
        </div>

        <div className="filter-field">
          <MultiSelectDropdown
            label="🗂️ Segmento"
            options={segmentoOptions.map((s) => ({ value: s, label: s }))}
            selected={segmentos}
            onChange={setSegmentos}
            placeholder="Todos"
          />
        </div>

        <div className="filter-field">
          <MultiSelectDropdown
            label="🗓️ Meses"
            options={mesOptions.map((p) => ({ value: p, label: formatPeriod(p) }))}
            selected={meses}
            onChange={setMeses}
            placeholder="Todos"
            searchable={false}
          />
        </div>

        <div className="filter-field">
          <label>🔀 Agrupar por</label>
          <select style={{ width: "100%" }} value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
            <option value="marca">Marca</option>
            <option value="modelo">Modelo</option>
            <option value="proveedor">Proveedor</option>
          </select>
        </div>
        <div className="filter-field">
          <label>📊 Metrica</label>
          <select style={{ width: "100%" }} value={metric} onChange={(e) => setMetric(e.target.value as any)}>
            <option value="total_fob_dolars">FOB USD</option>
            <option value="total_unidades">Unidades</option>
          </select>
        </div>
      </div>

      <div className="kpi-row">
        <div className="panel" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="kpi-icon">📅</div>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>
              Ultimo mes{totals.lastPeriod ? ` (${formatPeriod(totals.lastPeriod)})` : ""}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)" }}>
              {fmtNumber(totals.lastMonth.fob)} <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 400 }}>USD FOB</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
              {fmtNumber(totals.lastMonth.unidades)} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>Unidades</span>
            </div>
          </div>
        </div>
        <div className="panel" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="kpi-icon">🗓️</div>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>
              Ultimos {totals.last12Count || 12} meses
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)" }}>
              {fmtNumber(totals.last12.fob)} <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 400 }}>USD FOB</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
              {fmtNumber(totals.last12.unidades)} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>Unidades</span>
            </div>
          </div>
        </div>
      </div>

      <div className="stack-row">
        <TopCard title="Top Importador" lastMonth={topImporter.lastMonth} last12={topImporter.last12} last12Label={`Ultimos ${totals.last12Count || 12} meses`} />
        <TopCard title="Top Marca" lastMonth={topBrand.lastMonth} last12={topBrand.last12} last12Label={`Ultimos ${totals.last12Count || 12} meses`} />
        <TopCard title="Top Modelo" lastMonth={topModel.lastMonth} last12={topModel.last12} last12Label={`Ultimos ${totals.last12Count || 12} meses`} />
      </div>

      <div className="panel">
        {loading ? <p style={{ color: "var(--muted)" }}>Cargando...</p> : (
          <div className="chart-wrap">
            <EvolutionChart
              data={filteredSeries}
              groupBy={groupBy}
              metric={metric}
              topN={9}
              pinnedKeys={groupBy === "marca" ? ["Mugi", "Magesa"] : []}
              onPivotChange={setPivot}
            />
          </div>
        )}
      </div>

      <div className="stack-row">
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
        onViewImage={(marca, modelo, segmento) => setViewingModel({ marca, modelo, segmento })}
        pvpEntry={pvpEntryFor}
        pvpLoadingKeys={pvpLoadingKeys}
        onConsultPvp={handleConsultPvp}
      />

      {viewingModel && (
        <ModelImageModal
          key={modelImageKey(viewingModel.marca, viewingModel.modelo)}
          marca={viewingModel.marca}
          modelo={viewingModel.modelo}
          categorySlug={slug}
          segmentoActual={viewingModel.segmento}
          entry={modelImages.get(modelImageKey(viewingModel.marca, viewingModel.modelo))}
          onClose={() => setViewingModel(null)}
          onResolved={(img) =>
            setModelImages((prev) => {
              const next = new Map(prev);
              next.set(modelImageKey(img.marca, img.modelo), img);
              return next;
            })
          }
          onOverrideSaved={reloadSeries}
        />
      )}

      <div className="stack-row">
        <SegmentoPieChart
          rows={shareBySegmento}
          last12Label={`Ultimos ${totals.last12Count || 12} meses moviles`}
        />
        <ShareTable
          title="Share por Segmento"
          nameLabel="Segmento"
          rows={shareBySegmento}
          last12Label={`Ultimos ${totals.last12Count || 12} meses moviles`}
        />
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
    </>
  );
}
