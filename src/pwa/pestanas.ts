/**
 * Saludo entre pestañas. La migración reescribe lo guardado, así que no debe empezar mientras haya otra pestaña
 * con una versión del juego que no entienda lo nuevo y pueda volver a escribirlo sin sus campos.
 * El service worker sabe cuántas pestañas hay abiertas; cada pestaña con esta versión contesta al saludo por un
 * BroadcastChannel. Las que faltan por contestar son las antiguas.
 */
export const VERSION_DATOS = 1;
const CANAL = "dd:pestanas";
const ESPERA_SALUDO_MS = 300;
const ESPERA_SW_MS = 500;

type Mensaje = { t: "hola" } | { t: "aqui"; v: number } | { t: "recargar"; v: number };

const hayCanal = (): boolean => typeof BroadcastChannel !== "undefined";

/** Cuántas pestañas contestan al saludo con esta versión o una posterior, contando la propia. */
export function contarActuales(espera = ESPERA_SALUDO_MS): Promise<number> {
  if (!hayCanal()) return Promise.resolve(1);
  return new Promise((resolver) => {
    const canal = new BroadcastChannel(CANAL);
    let otras = 0;
    canal.onmessage = (e: MessageEvent<Mensaje>) => {
      if (e.data.t === "aqui" && e.data.v >= VERSION_DATOS) otras += 1;
    };
    canal.postMessage({ t: "hola" } satisfies Mensaje);
    setTimeout(() => {
      canal.close();
      resolver(otras + 1);
    }, espera);
  });
}

/** null si el service worker no contesta (no hay, o es una versión que aún no sabe contar). */
export function contarPestanasAbiertas(espera = ESPERA_SW_MS): Promise<number | null> {
  const controlador = typeof navigator === "undefined" ? undefined : navigator.serviceWorker?.controller;
  if (!controlador) return Promise.resolve(null);
  return new Promise((resolver) => {
    const canal = new MessageChannel();
    const temporizador = setTimeout(() => resolver(null), espera);
    canal.port1.onmessage = (e: MessageEvent<{ clientes?: unknown }>) => {
      clearTimeout(temporizador);
      resolver(typeof e.data?.clientes === "number" ? e.data.clientes : null);
    };
    controlador.postMessage({ type: "dd:clientes" }, [canal.port2]);
  });
}

/** Pura: lo abierto menos lo que ya saludó con la versión actual. Sin dato del service worker no se puede saber: 0. */
export function antiguasDe(abiertas: number | null, actuales: number): number {
  return abiertas === null ? 0 : Math.max(0, abiertas - actuales);
}

export async function pestanasAntiguas(): Promise<number> {
  const [abiertas, actuales] = await Promise.all([contarPestanasAbiertas(), contarActuales()]);
  return antiguasDe(abiertas, actuales);
}

/** Pide a las otras pestañas de una versión anterior a la actual que se recarguen. */
export function recargarAntiguas(): void {
  if (!hayCanal()) return;
  const canal = new BroadcastChannel(CANAL);
  canal.postMessage({ t: "recargar", v: VERSION_DATOS } satisfies Mensaje);
  canal.close();
}

/** Contesta a los saludos y a las peticiones de recarga mientras la pestaña viva. Devuelve cómo dejar de escuchar. */
export function saludar(recargar: () => void = () => window.location.reload()): () => void {
  if (!hayCanal()) return () => {};
  const canal = new BroadcastChannel(CANAL);
  canal.onmessage = (e: MessageEvent<Mensaje>) => {
    if (e.data.t === "hola") canal.postMessage({ t: "aqui", v: VERSION_DATOS } satisfies Mensaje);
    else if (e.data.t === "recargar" && e.data.v > VERSION_DATOS) recargar();
  };
  return () => canal.close();
}
