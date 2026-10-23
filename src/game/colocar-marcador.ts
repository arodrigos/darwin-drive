export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Aire entre el icono y lo que tiene al lado: la placa negra se lee suelta del coche y del rótulo. */
const HUECO_PX = 4;
/** Más lejos que esto el icono deja de leerse como del coche. */
const MAX_ALTURAS_COCHE = 1.5;

export function cruzan(a: Caja, b: Caja): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Distancia entre los bordes de dos cajas (0 si se tocan o se cruzan). */
function distancia(a: Caja, b: Caja): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/**
 * Dónde pintar el icono de causa de un coche parado sin tapar su rótulo «fin · N m».
 * Prueba a la derecha del coche, a su izquierda y por encima del rótulo; después, encima y debajo del coche
 * como último recurso. En cada lado desliza el icono para esquivar lo que estorbe. Función pura: las mismas
 * entradas dan siempre la misma caja.
 */
export function colocarMarcador(coche: Caja, etiqueta: Caja | null, viewport: { w: number; h: number }, icono: { w: number; h: number }): Caja {
  const cx = coche.x + (coche.w - icono.w) / 2;
  const cy = coche.y + (coche.h - icono.h) / 2;
  const derecha = coche.x + coche.w + HUECO_PX;
  const izquierda = coche.x - icono.w - HUECO_PX;
  const sobreEtiqueta = (etiqueta ? etiqueta.y : coche.y) - icono.h - HUECO_PX;
  const encima = coche.y - icono.h - HUECO_PX;
  const debajo = coche.y + coche.h + HUECO_PX;
  const lados = (x: number): Array<[number, number]> => [
    [x, cy],
    [x, coche.y],
    [x, coche.y + coche.h - icono.h],
  ];
  const centrados = (y: number): Array<[number, number]> => [
    [cx, y],
    [coche.x, y],
    [coche.x + coche.w - icono.w, y],
  ];
  const candidatos: Array<[number, number]> = [...lados(derecha), ...lados(izquierda), ...centrados(sobreEtiqueta), ...centrados(encima), ...centrados(debajo)];
  const maxDist = coche.h * MAX_ALTURAS_COCHE;
  let primero: Caja | null = null;
  for (const [x, y] of candidatos) {
    const caja = { x, y, w: icono.w, h: icono.h };
    primero ??= caja;
    const dentro = x >= 0 && y >= 0 && x + icono.w <= viewport.w && y + icono.h <= viewport.h;
    if (dentro && !cruzan(caja, coche) && !(etiqueta && cruzan(caja, etiqueta)) && distancia(caja, coche) <= maxDist) return caja;
  }
  // Sin hueco (coche enorme o viewport diminuto): el primer intento, metido en pantalla.
  const base = primero as Caja;
  return { ...base, x: Math.max(0, Math.min(viewport.w - icono.w, base.x)), y: Math.max(0, Math.min(viewport.h - icono.h, base.y)) };
}
