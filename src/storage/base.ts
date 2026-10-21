import { createStore, type UseStore } from "idb-keyval";

/** Solo con ?pruebas=1 (y en el navegador): el jugador normal nunca llega a la base de pruebas. */
export function modoPruebas(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("pruebas") === "1";
}

// Los escenarios y las carreras de prueba escriben aquí, nunca en la base del jugador:
// un coche de demostración no puede acabar mezclado con el garaje real.
const BASE_PRUEBAS = "darwin-drive-pruebas";
const BASE_JUGADOR = "keyval-store"; // la que usa idb-keyval por defecto, donde ya vive todo lo guardado

/** Abre la base que toca según el modo. Lanza si el navegador no deja abrir IndexedDB. */
export function abrirBase(): UseStore {
  return modoPruebas() ? createStore(BASE_PRUEBAS, "datos") : createStore(BASE_JUGADOR, "keyval");
}
