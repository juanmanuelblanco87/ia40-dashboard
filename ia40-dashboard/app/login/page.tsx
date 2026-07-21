"use client";

import { useState } from "react";

/**
 * Portal de acceso (21/07/2026) -- ver middleware.ts para el detalle
 * completo de por qué existe y cómo protege el resto de la app. Estilo
 * visual propio (paleta teal de Icom Salud, igual al resto de esta app),
 * pero el mismo criterio simple del proyecto de referencia que compartió
 * el usuario (`icom_panel_unificado.html`): usuario/contraseña
 * compartidos entre el equipo, no cuentas individuales.
 *
 * Logo: usa "Logo Icomsalud.png" (fondo blanco) -- no el
 * "logo-icomsalud-teal.png" que se usa en el header oscuro, porque acá
 * queda sobre la tarjeta blanca y se veía metido en una caja verde
 * (pedido explícito del usuario, 21/07/2026).
 *
 * Despues de un login correcto siempre entra a "/" (Módulo de
 * Importaciones) -- antes volvía a la página desde la que te habían
 * redirigido (`?from=`), pero el usuario pidió explícitamente que entre
 * siempre al módulo principal.
 */
export default function LoginPage() {
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const submit = () => {
    if (enviando) return;
    setError(null);
    setEnviando(true);
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, contrasena }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          setError(d.error ?? "Usuario o contraseña incorrectos.");
          return;
        }
        window.location.href = "/";
      })
      .catch(() => setError("No se pudo iniciar sesión. Probá de nuevo."))
      .finally(() => setEnviando(false));
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--header-bg, #025f5b)",
      }}
    >
      <div
        className="panel"
        style={{ width: 320, textAlign: "center", margin: 0 }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/Logo%20Icomsalud.png" alt="Icom Salud" style={{ width: "100%", maxWidth: 220, marginBottom: 20 }} />
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 18 }}>Acceso restringido</div>
        <div style={{ textAlign: "left", marginBottom: 10 }}>
          <input
            type="text"
            placeholder="Usuario"
            autoComplete="username"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <input
            type="password"
            placeholder="Contraseña"
            autoComplete="current-password"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
          />
        </div>
        <button onClick={submit} disabled={enviando} style={{ width: "100%" }}>
          {enviando ? "Ingresando..." : "Ingresar"}
        </button>
        {error && <div style={{ color: "#d93a3a", fontSize: 12, marginTop: 10 }}>{error}</div>}
      </div>
    </div>
  );
}
