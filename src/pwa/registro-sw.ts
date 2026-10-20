import { conectarCiclo, pulsarRecargar, type SerwistVentana } from "./ciclo";

const URL_SW = "/serwist/sw.js";
const CLAVE_URL_FORZADA = "pwa:url-forzada";

export function urlServiceWorker(): string {
  return window.sessionStorage.getItem(CLAVE_URL_FORZADA) ?? URL_SW;
}

export function fijarUrlForzada(url: string): void {
  window.sessionStorage.setItem(CLAVE_URL_FORZADA, url);
}

let actual: SerwistVentana | null = null;

// Interruptor de emergencia: si la caché sirviera algo que no es lo
// desplegado, /?sw=0 devuelve el origen a su estado sin service worker.
export async function desinstalar(): Promise<void> {
  const registros = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registros.map((registro) => registro.unregister()));
  for (const nombre of await caches.keys()) await caches.delete(nombre);
  window.sessionStorage.removeItem(CLAVE_URL_FORZADA);
  const url = new URL(window.location.href);
  url.searchParams.delete("sw");
  window.location.replace(url.pathname + url.search + url.hash);
}

export async function registrarServiceWorker(url: string): Promise<void> {
  // Import dinámico: @serwist/window no cuenta en el JS del primer arranque.
  const { Serwist } = await import("@serwist/window");
  const sw = new Serwist(url, { scope: "/", updateViaCache: "none", type: "classic" }) as unknown as SerwistVentana;
  conectarCiclo(sw, () => window.location.reload());
  actual = sw;
  await sw.register();
}

export function recargarVersionNueva(): void {
  if (actual) pulsarRecargar(actual);
}
