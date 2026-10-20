"use client";

import { useEffect, useSyncExternalStore } from "react";
import { obtenerDatosPwa, suscribirPwa } from "./estado";
import { desinstalar, recargarVersionNueva, registrarServiceWorker, urlServiceWorker } from "./registro-sw";

export const TEXTO_VERSION_NUEVA = "Hay una versión nueva · ";

function cuandoHayHueco(tarea: () => void): void {
  const lanzar = (): void => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(tarea);
    else window.setTimeout(tarea, 1);
  };
  if (document.readyState === "complete") lanzar();
  else window.addEventListener("load", lanzar, { once: true });
}

/** Registra el service worker (solo en el build de producción) y avisa de una versión nueva. */
export function RegistroPwa() {
  const datos = useSyncExternalStore(suscribirPwa, obtenerDatosPwa, obtenerDatosPwa);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    if (new URLSearchParams(window.location.search).get("sw") === "0") {
      void desinstalar();
      return;
    }
    let cancelado = false;
    cuandoHayHueco(() => {
      if (!cancelado) registrarServiceWorker(urlServiceWorker()).catch(() => undefined);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  if (!datos.esperando) return null;
  return (
    <div className="aviso-version" role="status" data-testid="aviso-version-nueva">
      {TEXTO_VERSION_NUEVA}
      <button type="button" className="pastilla chica" data-testid="recargar-version" onClick={recargarVersionNueva}>
        Recargar
      </button>
    </div>
  );
}
