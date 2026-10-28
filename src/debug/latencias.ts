// Latencia de una interacción, con dos cifras:
//  - trabajoMs: de la entrada al final del JS que aplica el efecto. Es lo que controla el producto
//    y lo que se juzga en el CI, donde el dibujo es por software.
//  - ms: de la entrada al requestAnimationFrame siguiente, el del primer fotograma con el efecto.
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
  requestAnimationFrame(() => {
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
  });
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
}
