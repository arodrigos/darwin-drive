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
    plugins: [
      {
        cacheWillUpdate: async ({ response }) => (respuestaPrecacheable(response, self.location.origin) ? response : null),
      },
    ],
  },
});

serwist.addEventListeners();
