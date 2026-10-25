import { actualizarClave, leerClave } from "@/storage/store";
import { KEY_BATALLA, validarBatalla, type EstadoBatalla } from "./estado";

/** Un estado ilegible o de otra versión se trata como «no hay batalla»: la portada no ofrece continuarla. */
export async function cargarBatalla(): Promise<EstadoBatalla | null> {
  return validarBatalla(await leerClave(KEY_BATALLA));
}

/** Se llama en cada transición: una recarga o un bloqueo de pantalla vuelve al último relevo. */
export async function guardarBatalla(e: EstadoBatalla): Promise<void> {
  await actualizarClave(KEY_BATALLA, () => e);
}

/** Abandonar o salir borra también los nombres de los jugadores. */
export async function borrarBatalla(): Promise<void> {
  await actualizarClave(KEY_BATALLA, () => null);
}
