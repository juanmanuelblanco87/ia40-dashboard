"use client";

import { useEffect, useRef, useState } from "react";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
}

/**
 * Dropdown desplegable con checkboxes (y buscador opcional) para elegir
 * varios valores a la vez. Se cierra solo al hacer click afuera.
 */
export default function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder = "Todas",
  searchable = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
      ? options.filter((o) => selected.includes(o.value)).map((o) => o.label).join(", ")
      : `${selected.length} seleccionadas`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label>{label}</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth: 180,
          textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 20,
            marginTop: 4,
            width: 260,
            maxHeight: 320,
            overflowY: "auto",
            background: "#171a21",
            border: "1px solid #2a2e37",
            borderRadius: 8,
            padding: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {searchable && (
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              style={{ width: "100%", marginBottom: 8, boxSizing: "border-box" }}
            />
          )}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              style={{ width: "100%", marginBottom: 8, fontSize: 12 }}
            >
              Limpiar seleccion
            </button>
          )}
          {filtered.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: 4 }}>Sin resultados</div>
          )}
          {filtered.map((o) => (
            <label
              key={o.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 2px",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
