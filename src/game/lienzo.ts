import type Phaser from "phaser";

// Este módulo solo importa tipos de Phaser: lo usan las pantallas antes de cargar Phaser (carga diferida).

/** Un navegador solo aguanta unos 16 contextos WebGL vivos: pasado el límite, el más viejo se pierde y el lienzo queda negro. */
export const contadoresLienzo = {
  sondas: 0,
  creados: 0,
  liberados: 0,
  perdidos: 0,
  recuperados: 0,
};

export type EstadoLienzo = "ok" | "recuperando" | "perdido" | "sin-lienzo";

export const MENSAJE_RECUPERANDO = "Recuperando el dibujo…";
export const MENSAJE_PERDIDO =
  "El dibujo se ha perdido. La carrera sigue: toca «Reintentar dibujo».";
export const ESPERA_RESTAURAR_MS = 5000;
export const VENTANA_RECUPERACIONES_MS = 60000;
export const MAX_RECUPERACIONES = 3;

let soporte: boolean | null = null;
let estadoActual: EstadoLienzo = "ok";

/** Solo para los tests unitarios: vuelve a la situación de una sesión recién abierta. */
export function reiniciarLienzo(): void {
  soporte = null;
  estadoActual = "ok";
  Object.assign(contadoresLienzo, {
    sondas: 0,
    creados: 0,
    liberados: 0,
    perdidos: 0,
    recuperados: 0,
  });
}

/** Lo que enseña estado().lienzo: el de la pantalla con lienzo más reciente. */
export function estadoLienzo(): EstadoLienzo {
  return estadoActual;
}

function liberarContexto(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
): void {
  try {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Un contexto que ya estaba perdido no tiene extensión que llamar.
  }
}

/** Una sola sonda por sesión: cada llamada a getContext sobre un canvas nuevo gasta un contexto del navegador. */
export function puedeDibujar(): boolean {
  if (soporte !== null) return soporte;
  contadoresLienzo.sondas++;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as
      WebGLRenderingContext | WebGL2RenderingContext | null;
    if (gl) {
      liberarContexto(gl);
      soporte = true;
    } else {
      soporte = Boolean(c.getContext("2d"));
    }
  } catch {
    soporte = false;
  }
  return soporte;
}

function contextoGl(
  canvas: HTMLCanvasElement,
): WebGLRenderingContext | WebGL2RenderingContext | null {
  // Sobre un canvas que ya tiene contexto, getContext devuelve el mismo en vez de crear otro.
  return (canvas.getContext("webgl2") || canvas.getContext("webgl")) as
    WebGLRenderingContext | WebGL2RenderingContext | null;
}

/** Suelta el contexto WebGL del juego antes de destruirlo: sin esto, destroy() deja el contexto vivo hasta que el recolector pase. */
export function liberarJuego(game: Phaser.Game): void {
  const canvas = game.canvas as HTMLCanvasElement | undefined;
  if (canvas) liberarContexto(contextoGl(canvas));
  contadoresLienzo.liberados++;
  game.destroy(true);
}

/** Atiende la pérdida y la vuelta del contexto; devuelve la función que deja de escuchar. */
export function vigilarContexto(
  canvas: HTMLCanvasElement,
  h: { perdido(): void; recuperado(): void },
): () => void {
  const perdido = (e: Event) => {
    // Sin preventDefault el navegador da el contexto por muerto y nunca lo devuelve.
    e.preventDefault();
    h.perdido();
  };
  const recuperado = () => h.recuperado();
  canvas.addEventListener("webglcontextlost", perdido);
  canvas.addEventListener("webglcontextrestored", recuperado);
  return () => {
    canvas.removeEventListener("webglcontextlost", perdido);
    canvas.removeEventListener("webglcontextrestored", recuperado);
  };
}

/** Reduce el lienzo a 32x32 y cuenta los píxeles casi negros: un lienzo perdido o sin pintar sale con casi todo negro. */
export function muestrear(canvas: HTMLCanvasElement): {
  ancho: number;
  alto: number;
  fraccionNegra: number;
} {
  const N = 32;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const ctx = c.getContext("2d");
  if (!ctx)
    return { ancho: canvas.width, alto: canvas.height, fraccionNegra: 1 };
  ctx.drawImage(canvas, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  let negros = 0;
  for (let i = 0; i < d.length; i += 4) {
    const luminancia = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    if (d[i + 3] === 0 || luminancia < 16) negros++;
  }
  return {
    ancho: canvas.width,
    alto: canvas.height,
    fraccionNegra: negros / (N * N),
  };
}

export interface Gestor {
  /** Junta el canvas del juego vivo, si lo hay. */
  canvas(): HTMLCanvasElement | null;
  /** El juego vivo ahora (cambia al rehacerse). */
  juego(): Phaser.Game | null;
  destruir(): void;
}

export interface OpcionesGestor {
  /** Ni siquiera un juego nuevo se deja crear: la pantalla enseña su mensaje sin-lienzo con «Volver». */
  alSinLienzo?: () => void;
}

const gestores = new Set<
  Gestor & { perder(restaurar: boolean, ms: number): Promise<void> }
>();

/**
 * Posee el Phaser.Game de una pantalla y lo rehace cuando el contexto se pierde y vuelve.
 * `crear(true)` se llama en cada reconstrucción: quien lo pasa traspasa a la escena nueva lo que la vieja sabía.
 * La escena solo lee poses, así que rehacerla no toca la simulación.
 */
export function gestionarLienzo(
  parent: HTMLElement,
  crear: (reconstruccion: boolean) => Phaser.Game,
  opciones: OpcionesGestor = {},
): Gestor {
  let juego: Phaser.Game | null = null;
  let soltar: (() => void) | null = null;
  let estado: EstadoLienzo = "ok";
  let destruido = false;
  let espera: ReturnType<typeof setTimeout> | null = null;
  let aviso: HTMLDivElement | null = null;
  const recientes: number[] = [];

  const publicar = (e: EstadoLienzo) => {
    estado = e;
    estadoActual = e;
  };

  const quitarAviso = () => {
    aviso?.remove();
    aviso = null;
  };

  const mostrar = (id: string, texto: string, boton: boolean) => {
    quitarAviso();
    if (getComputedStyle(parent).position === "static")
      parent.style.position = "relative";
    const div = document.createElement("div");
    div.className = "lienzo-aviso";
    div.setAttribute("data-testid", id);
    div.setAttribute("role", boton ? "alert" : "status");
    const p = document.createElement("p");
    p.textContent = texto;
    div.appendChild(p);
    if (boton) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pastilla";
      b.setAttribute("data-testid", "lienzo-reintentar");
      b.textContent = "Reintentar dibujo";
      b.addEventListener("click", reintentar);
      div.appendChild(b);
    }
    parent.appendChild(div);
    aviso = div;
  };

  const parar = () => {
    if (espera) clearTimeout(espera);
    espera = null;
    soltar?.();
    soltar = null;
  };

  const retirarJuego = () => {
    parar();
    if (juego) liberarJuego(juego);
    juego = null;
  };

  const arrancar = (reconstruccion: boolean): boolean => {
    try {
      const g = crear(reconstruccion);
      contadoresLienzo.creados++;
      juego = g;
      const enganchar = () => {
        if (destruido || juego !== g || !g.canvas) return;
        soltar = vigilarContexto(g.canvas as HTMLCanvasElement, {
          perdido: alPerder,
          recuperado: alRecuperar,
        });
      };
      if (g.canvas) enganchar();
      else g.events.once("ready", enganchar);
      return true;
    } catch {
      return false;
    }
  };

  const sinLienzo = () => {
    publicar("sin-lienzo");
    quitarAviso();
    opciones.alSinLienzo?.();
  };

  function perdidoParaSiempre() {
    parar();
    publicar("perdido");
    mostrar("lienzo-perdido", MENSAJE_PERDIDO, true);
  }

  function alPerder() {
    if (destruido || estado === "perdido") return;
    contadoresLienzo.perdidos++;
    publicar("recuperando");
    mostrar("lienzo-recuperando", MENSAJE_RECUPERANDO, false);
    if (espera) clearTimeout(espera);
    espera = setTimeout(() => {
      espera = null;
      if (!destruido && estado === "recuperando") perdidoParaSiempre();
    }, ESPERA_RESTAURAR_MS);
  }

  function alRecuperar() {
    if (destruido || estado !== "recuperando") return;
    if (espera) clearTimeout(espera);
    espera = null;
    const ahora = performance.now();
    while (
      recientes.length > 0 &&
      ahora - recientes[0] > VENTANA_RECUPERACIONES_MS
    )
      recientes.shift();
    if (recientes.length >= MAX_RECUPERACIONES) return perdidoParaSiempre();
    recientes.push(ahora);
    contadoresLienzo.recuperados++;
    // Fuera del evento: destruir el juego dentro de los oyentes de su propio lienzo pisa los de Phaser.
    setTimeout(() => {
      if (destruido) return;
      reconstruir();
    }, 0);
  }

  function reconstruir() {
    retirarJuego();
    if (!arrancar(true)) return sinLienzo();
    quitarAviso();
    publicar("ok");
  }

  function reintentar() {
    if (destruido) return;
    reconstruir();
  }

  if (!arrancar(false)) throw new Error("no se pudo crear el juego");
  publicar("ok");

  const gestor = {
    juego: () => juego,
    canvas: () => (juego?.canvas as HTMLCanvasElement | undefined) ?? null,
    destruir() {
      if (destruido) return;
      destruido = true;
      gestores.delete(gestor);
      quitarAviso();
      retirarJuego();
      if (gestores.size === 0) estadoActual = "ok";
    },
    // Solo pruebas: pierde el contexto de verdad con la extensión del navegador y, si se pide, lo devuelve.
    async perder(restaurar: boolean, ms: number) {
      const canvas = this.canvas();
      if (!canvas) return;
      const gl = contextoGl(canvas);
      const ext = gl?.getExtension("WEBGL_lose_context");
      if (!ext) return;
      ext.loseContext();
      if (restaurar) {
        await new Promise<void>((ok) => setTimeout(ok, ms));
        try {
          ext.restoreContext();
        } catch {
          // El contexto ya se había dado por perdido para siempre.
        }
      }
    },
  };
  gestores.add(gestor);
  return gestor;
}

/** Gancho de pruebas: pierde el contexto de la pantalla actual. */
export async function perderLienzo(
  op: { restaurar?: boolean; msRestaurar?: number } = {},
): Promise<void> {
  const actual = [...gestores].pop();
  await actual?.perder(op.restaurar !== false, op.msRestaurar ?? 300);
}

/** Gancho de pruebas: muestrea el lienzo visible. */
export function muestraLienzo(): {
  ancho: number;
  alto: number;
  fraccionNegra: number;
} {
  const canvas = [...gestores].pop()?.canvas();
  return canvas ? muestrear(canvas) : { ancho: 0, alto: 0, fraccionNegra: 1 };
}
