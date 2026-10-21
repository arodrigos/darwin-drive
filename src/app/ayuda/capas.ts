"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Capa = { tipo: "ayuda" } | { tipo: "guia"; seccion: string | null } | { tipo: "nombre" };

/**
 * Pila de capas (panel de ayuda, guía) con el «atrás» del sistema.
 * Cada capa empuja una entrada de historial: cerrar con ✕, Esc o el fondo pide `history.back()` y
 * quien cierra de verdad es `popstate`, así el botón del sistema y los demás caminos son el mismo.
 */
export function useCapas() {
  const [capas, setCapas] = useState<Capa[]>([]);
  const profundidad = useRef(0);

  useEffect(() => {
    const alAtras = () => {
      if (profundidad.current === 0) return;
      profundidad.current -= 1;
      setCapas((c) => c.slice(0, -1));
    };
    window.addEventListener("popstate", alAtras);
    return () => window.removeEventListener("popstate", alAtras);
  }, []);

  const abrir = useCallback((capa: Capa) => {
    profundidad.current += 1;
    window.history.pushState({ capa: profundidad.current }, "");
    setCapas((c) => [...c, capa]);
  }, []);

  const cerrarArriba = useCallback(() => {
    if (profundidad.current > 0) window.history.back();
  }, []);

  return { capas, abrir, cerrarArriba };
}
