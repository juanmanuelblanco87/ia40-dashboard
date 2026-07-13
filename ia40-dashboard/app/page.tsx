"use client";

import { useEffect, useState } from "react";

interface Category {
  id: number;
  slug: string;
  name: string;
}

interface ProviderRow {
  importer_name: string;
  total_fob_dolars: string;
  record_count: string;
  marca: string | null;
  modelo: string | null;
}

export default function AdminPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [slug, setSlug] = useState("");
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { marca: string; modelo: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
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
    fetch(`/api/providers?category=${slug}`)
      .then((r) => r.json())
      .then((d) => {
        const rows: ProviderRow[] = d.providers ?? [];
        setProviders(rows);
        const nextDrafts: Record<string, { marca: string; modelo: string }> = {};
        for (const r of rows) {
          nextDrafts[r.importer_name] = { marca: r.marca ?? "", modelo: r.modelo ?? "" };
        }
        setDrafts(nextDrafts);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const reload = () => {
    if (!slug) return;
    fetch(`/api/providers?category=${slug}`)
      .then((r) => r.json())
      .then((d) => {
        const rows: ProviderRow[] = d.providers ?? [];
        setProviders(rows);
      });
  };

  const save = async (importerName: string) => {
    const draft = drafts[importerName];
    if (!draft?.marca) {
      alert("La marca es obligatoria para guardar.");
      return;
    }
    setSaving(importerName);
    try {
      await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: slug,
          importer_name: importerName,
          marca: draft.marca,
          modelo: draft.modelo || null,
        }),
      });
      reload();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="container">
      <h1>Mapeo de marcas por importador</h1>
      <h2>
        IA40 no trae marca/modelo directo en los datos de esta categoria. Identificá
        la marca (y el modelo, si lo sabés) para cada empresa importadora. Se puede ir
        completando de a poco: lo que falte queda como "sin_identificar" en el gráfico.
      </h2>

      <div className="panel row">
        <div>
          <label>Categoria</label>
          <select value={slug} onChange={(e) => setSlug(e.target.value)}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel">
        {loading ? (
          <p style={{ color: "var(--muted)" }}>Cargando...</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Importador</th>
                <th>FOB total (USD)</th>
                <th>Registros</th>
                <th>Marca</th>
                <th>Modelo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.importer_name}>
                  <td>{p.importer_name}</td>
                  <td>
                    {Number(p.total_fob_dolars).toLocaleString("es-AR", {
                      maximumFractionDigits: 0,
                    })}
                  </td>
                  <td>{p.record_count}</td>
                  <td>
                    <input
                      value={drafts[p.importer_name]?.marca ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [p.importer_name]: { ...d[p.importer_name], marca: e.target.value },
                        }))
                      }
                      placeholder="Marca"
                    />
                  </td>
                  <td>
                    <input
                      value={drafts[p.importer_name]?.modelo ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [p.importer_name]: { ...d[p.importer_name], modelo: e.target.value },
                        }))
                      }
                      placeholder="Modelo (opcional)"
                    />
                  </td>
                  <td>
                    <button onClick={() => save(p.importer_name)} disabled={saving === p.importer_name}>
                      {saving === p.importer_name ? "Guardando..." : "Guardar"}
                    </button>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)" }}>
                    No hay datos todavia para esta categoria. Corre /api/sync primero.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
