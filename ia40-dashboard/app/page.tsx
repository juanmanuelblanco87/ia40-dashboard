"use client";

import { useEffect, useState } from "react";
import EvolutionChart, { SeriesPoint } from "@/components/EvolutionChart";

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
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [options, setOptions] = useState<{ marca: string; modelo: string }[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="container">
      <h1>IA40 — Evolucion mensual por categoria</h1>
      <h2>Datos sincronizados desde Cobus Group, agregados por marca / modelo / proveedor.</h2>

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
      </div>

      <div className="panel">
        {loading ? <p style={{ color: "var(--muted)" }}>Cargando...</p> : (
          <EvolutionChart data={series} groupBy={groupBy} />
        )}
      </div>

      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Los datos se actualizan una vez por dia via /api/sync (Vercel Cron).
        Si una categoria no tiene marca/modelo mapeados todavia, esas columnas
        aparecen como "sin_dato" hasta cargar el mapeo en field_mappings.
      </p>
    </div>
  );
}
