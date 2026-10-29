// Latencia de una interacción, con dos cifras:
//  - trabajoMs: de la entrada al final del JS que aplica el efecto. Es lo que controla el producto
//    y lo que se juzga en el CI, donde el dibujo es por software.
//  - ms: de la entrada al fotograma ya pintado: se cierra en un setTimeout lanzado desde el rAF, que
//    corre cuando el navegador ha terminado ese fotograma (DebugBear). Cerrarlo en el propio rAF
//    mediría antes del pintado y el panel saldría verde siempre.
//    Es lo que percibe el jugador y lo que se valida en el dispositivo.
// Se mide siempre (cuesta una marca) pero solo se expone con ?pruebas=1 o en el panel ?rendimiento=1.
export interface Latencia {
  evento: string;
  ms: number;
  trabajoMs: number;
  t: number;
}

const MAX_MEDIDAS = 50;
const medidas: Latencia[] = [];
const marcas = new Map<string, number>();
const enCurso = new Map<string, (() => void)[]>();
const listeners = new Set<() => void>();

export function markInput(evento: string): void {
  marcas.set(evento, performance.now());
  performance.mark(`dd:${evento}:entrada`);
}

/** Llamar justo después de aplicar el efecto: anota el trabajo ahora y los ms hasta el siguiente requestAnimationFrame. */
export function measureOnNextFrame(evento: string): void {
  const inicio = marcas.get(evento);
  if (inicio === undefined) return;
  marcas.delete(evento);
  const trabajoMs = Math.max(0, performance.now() - inicio);
  const colas = enCurso.get(evento) ?? [];
  enCurso.set(evento, colas);
  requestAnimationFrame(() =>
    setTimeout(() => {
      const ahora = performance.now();
      try {
        performance.measure(`dd:${evento}`, { start: inicio, end: ahora });
      } catch {
        // Un navegador sin measure con opciones sigue teniendo la medida propia.
      }
      // El fotograma llega siempre después del trabajo; el máximo evita un reloj que retroceda.
      medidas.push({ evento, ms: Math.max(trabajoMs, ahora - inicio), trabajoMs, t: ahora });
      if (medidas.length > MAX_MEDIDAS) medidas.shift();
      listeners.forEach((l) => l());
      if (enCurso.get(evento) === colas) enCurso.delete(evento);
      colas.forEach((fn) => fn());
    }, 0),
  );
}

/** Ejecuta fn cuando la medida de ese evento ya está cerrada; sin medida en curso, en el siguiente turno. */
export function despuesDeMedir(evento: string, fn: () => void): void {
  const colas = enCurso.get(evento);
  if (colas) colas.push(fn);
  else setTimeout(fn, 0);
}

export function latencias(): Latencia[] {
  return medidas.map((m) => ({ ...m }));
}

export function onLatencia(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Solo para pruebas unitarias: vacía medidas y marcas pendientes. */
export function reiniciarLatencias(): void {
  medidas.length = 0;
  marcas.clear();
  enCurso.clear();
}
