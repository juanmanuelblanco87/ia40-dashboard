"use client";

import type { ReactNode } from "react";

/**
 * Header compartido entre el Modulo de Importaciones (app/page.tsx) y el
 * Calculador de Importacion (app/calculo-importacion/page.tsx) -- extraido
 * de page.tsx (20/07/2026) para poder reusarlo en la pagina nueva sin
 * duplicar el logo/estilos. `actions` recibe los botones de navegacion
 * propios de cada pagina (ej. "Cálculo de Importación" en el modulo
 * principal, "Volver al módulo de importaciones" en la calculadora).
 */
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
        {actions && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>{actions}</div>}
      </div>
    </header>
  );
}
