import { Serwist, type PrecacheEntry } from "serwist";
import { respuestaPrecacheable } from "@/pwa/filtro-precache";

declare const self: { __SW_MANIFEST: (PrecacheEntry | string)[]; location: { origin: string } };

// skipWaiting a false a propósito (la guía oficial lo trae a true): una versión
// nueva solo se activa cuando el jugador toca Recargar, así una evolución en
// curso no se interrumpe ni mezcla trozos de dos builds. clientsClaim solo
// actúa al activarse, así que en la primera instalación toma la página sin recargarla.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  // Todo el juego es procedimental y sin URLs externas: está en el precache.
  runtimeCaching: [],
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // Una sola página: «/», «/?pruebas=1» o «/?rendimiento=1» son el mismo HTML.
    ignoreURLParametersMatching: [/.*/],
    plugins: [
      {
        cacheWillUpdate: async ({ response }) => (respuestaPrecacheable(response, self.location.origin) ? response : null),
      },
    ],
  },
});

serwist.addEventListeners();

// La migración de marcas pregunta cuántas pestañas hay abiertas para no empezar con una versión antigua escribiendo.
interface MensajeClientes {
  data?: { type?: string };
  ports: { postMessage(m: unknown): void }[];
  waitUntil(p: Promise<unknown>): void;
}
const global = self as unknown as {
  clients: { matchAll(o: { type: string }): Promise<unknown[]> };
  addEventListener(t: "message", cb: (e: MensajeClientes) => void): void;
};
global.addEventListener("message", (e) => {
  if (e.data?.type !== "dd:clientes" || !e.ports[0]) return;
  const puerto = e.ports[0];
  e.waitUntil(global.clients.matchAll({ type: "window" }).then((c) => puerto.postMessage({ clientes: c.length })));
});
