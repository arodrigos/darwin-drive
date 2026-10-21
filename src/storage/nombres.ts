export const MAX_NOMBRE = 40;

const INVISIBLES = /[\p{Cc}\p{Cf}]/gu;

/** Limpia sin sustituto: devuelve "" si no queda nada (lo usa quien quiere omitir el nombre). */
export function limpiarNombre(s: string): string {
  const limpio = s.replace(INVISIBLES, "").replace(/\s+/gu, " ").trim();
  // Se corta por puntos de código, no por unidades UTF-16, para no partir un emoji por la mitad.
  return Array.from(limpio).slice(0, MAX_NOMBRE).join("").trim();
}

/**
 * Los nombres se escriben en la hoja, se leen de lo guardado y llegan en copias importadas: todos pasan por aquí.
 * Quita Cc y Cf (entre ellos los que invierten el texto, como U+202E), junta espacios y corta a 40 puntos de código.
 */
export function normalizarNombre(s: string, propuesto: string): string {
  return limpiarNombre(s) || limpiarNombre(propuesto) || "Coche";
}
