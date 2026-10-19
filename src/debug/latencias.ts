// Latencia de una interacción: desde el evento de entrada hasta el primer frame
// que pinta su efecto. Se mide siempre (cuesta una marca) pero solo se expone
// con ?pruebas=1 o en el panel ?rendimiento=1.
export interface Latencia {
  evento: string;
  ms: number;
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

/** Llamar justo después de aplicar el efecto: mide hasta el siguiente requestAnimationFrame. */
export function measureOnNextFrame(evento: string): void {
  const inicio = marcas.get(evento);
  if (inicio === undefined) return;
  marcas.delete(evento);
  requestAnimationFrame(() => {
    const ahora = performance.now();
    try {
      performance.measure(`dd:${evento}`, { start: inicio, end: ahora });
    } catch {
      // Un navegador sin measure con opciones sigue teniendo la medida propia.
    }
    medidas.push({ evento, ms: ahora - inicio, t: ahora });
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
