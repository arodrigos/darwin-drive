import { registrarServiceWorker, fijarUrlForzada } from "./registro-sw";

const TOPE_ESPERA_MS = 15_000;

/**
 * Gancho de pruebas (solo con ?pruebas=1): instala de verdad un worker nuevo
 * (otra URL del mismo script) que queda en espera, para probar el aviso real
 * sin esperar a un despliegue. Nunca recarga la página.
 */
export async function forzarVersionNueva(): Promise<void> {
  if (!("serviceWorker" in navigator) || !(await navigator.serviceWorker.getRegistration())) {
    throw new Error("No hay service worker: el aviso de versión nueva no se puede forzar");
  }
  const n = Number(window.sessionStorage.getItem("pwa:forzar") ?? "0") + 1;
  window.sessionStorage.setItem("pwa:forzar", String(n));
  const url = `/serwist/sw.js?forzar=${n}`;
  fijarUrlForzada(url);
  await registrarServiceWorker(url);
  const limite = Date.now() + TOPE_ESPERA_MS;
  while (Date.now() < limite) {
    const registro = await navigator.serviceWorker.getRegistration();
    if (registro?.waiting) return;
    await new Promise((resolver) => window.setTimeout(resolver, 100));
  }
  throw new Error("El service worker nuevo no llegó a quedar en espera");
}

