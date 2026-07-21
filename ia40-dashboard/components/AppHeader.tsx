"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * Header compartido entre el Modulo de Importaciones (app/page.tsx) y el
 * Calculador de Importacion (app/calculo-importacion/page.tsx) -- extraido
 * de page.tsx (20/07/2026) para poder reusarlo en la pagina nueva sin
 * duplicar el logo/estilos. `actions` recibe los botones de navegacion
 * propios de cada pagina (ej. "Cálculo de Importación" en el modulo
 * principal, "Volver al módulo de importaciones" en la calculadora).
 *
 * Dolar oficial BCRA (21/07/2026, pedido explicito del usuario): se
 * consulta UNA vez al montar el header via /api/bcra/tipo-cambio (que a
 * su vez llama a la API publica del BCRA, sin IA ni guardado en base) y se
 * muestra como dato informativo -- no tiene relacion con el "Tipo de
 * cambio" editable de Supuestos generales del Calculador (ese sigue
 * sirviendo para el calculo en si, este es solo para tener a mano el dato
 * del dia con un vistazo).
 */
function DolarBcra() {
  const [valor, setValor] = useState<number | null>(null);
  const [fecha, setFecha] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bcra/tipo-cambio")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.valor === "number") {
          setValor(d.valor);
          setFecha(d.fecha ?? null);
        }
      })
      .catch(() => {});
  }, []);

  if (valor == null) return null;
  return (
    <div
      style={{ fontSize: 12.5, color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" }}
      title={fecha ? `Dólar oficial mayorista (BCRA, Com. A 3500) del ${fecha}` : "Dólar oficial mayorista (BCRA, Com. A 3500)"}
    >
      USD oficial:{" "}
      <strong>
        ${valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </strong>
    </div>
  );
}

export default function AppHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {/* Click en el logo = refresh completo de la pagina (pedido
            explicito del usuario, 20/07/2026) -- util como "volver al
            inicio" rapido sin tener que usar el boton de refresh del
            navegador. */}
        <img
          src="/logo-icomsalud-teal.png"
          alt="Icom Salud"
          className="app-header-logo"
          onClick={() => window.location.reload()}
          title="Actualizar página"
          style={{ cursor: "pointer" }}
        />
        <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.25)" }} />
        <div className="app-header-title">{title}</div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <DolarBcra />
          {actions}
          <button
            className="app-header-nav-btn"
            onClick={() => {
              fetch("/api/logout", { method: "POST" }).finally(() => (window.location.href = "/login"));
            }}
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
