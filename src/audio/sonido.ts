import { decidir, estadoInicial, type RitmoSonido, type TipoSonido } from "./politica";

// Adaptador de cliente. ZzFX crea su AudioContext al importarse, así que solo se importa (dinámico)
// tras un gesto con el sonido encendido: nunca en el servidor ni en el trozo inicial.
type ModuloZzfx = typeof import("zzfx");

// Parámetros de ZzFX (volumen, azar, frecuencia, ataque, sostén, relajación, forma, curva, deslizamiento,
// deslizamiento delta, salto de tono, tiempo de salto, repetición, ruido, modulación, bitcrush, retardo,
// volumen de sostén, caída). El azar va a 0: las muestras se calculan una vez y son siempre las mismas.
const EFECTOS: Record<TipoSonido, number[]> = {
  arranque: [0.8, 0, 330, 0.01, 0.06, 0.12, 0, 1.2, 0, 0, 220, 0.05],
  record: [1, 0, 523, 0.02, 0.15, 0.3, 0, 1, 0, 0, 330, 0.08, 0, 0, 0, 0, 0, 0.8, 0.1],
  especie: [0.7, 0, 880, 0.01, 0.05, 0.18, 2, 1, 0, 0, 440, 0.04],
  vuelco: [1, 0, 110, 0.01, 0.1, 0.25, 3, 1.5, -5, 0, 0, 0, 0, 0.4],
};

export type ContextoSonido = "sin-crear" | "suspended" | "running" | "closed";

export interface EstadoSonidos {
  encendido: boolean;
  cargado: boolean;
  contexto: ContextoSonido;
  sesion: string | null;
  arranque: number;
  record: number;
  especie: number;
  vuelco: number;
  error: string | null;
}

interface AudioSessionLike {
  type: string;
}

let encendido = false;
let zz: ModuloZzfx | null = null;
let muestras: Partial<Record<TipoSonido, number[]>> = {};
let sesion: string | null = null;
let error: string | null = null;
let activando: Promise<void> | null = null;
let politica = estadoInicial();
const contadores: Record<TipoSonido, number> = { arranque: 0, record: 0, especie: 0, vuelco: 0 };
const oyentes = new Set<() => void>();
let alGuardar: ((encendido: boolean) => void) | null = null;
let esperandoGesto = false;
let visibilidadPuesta = false;
let cargar: () => Promise<ModuloZzfx> = () => import("zzfx");

/** Solo pruebas unitarias: en Node no hay AudioContext, así que se sustituye el import dinámico. */
export function inyectarCargadorZzfx(fn: () => Promise<ModuloZzfx>): void {
  cargar = fn;
  encendido = false;
  zz = null;
  muestras = {};
  sesion = null;
  error = null;
  activando = null;
  politica = estadoInicial();
  for (const t of Object.keys(contadores) as TipoSonido[]) contadores[t] = 0;
}

function avisar(): void {
  oyentes.forEach((o) => o());
}

export function suscribirSonido(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function sonidoEncendido(): boolean {
  return encendido;
}

export function sonidos(): EstadoSonidos {
  const estadoCtx = zz?.ZZFX.audioContext.state;
  return {
    encendido,
    cargado: zz !== null,
    contexto: estadoCtx === undefined ? "sin-crear" : estadoCtx === "interrupted" ? "suspended" : estadoCtx,
    sesion,
    ...contadores,
    error,
  };
}

async function activar(): Promise<void> {
  if (activando) return activando;
  activando = (async () => {
    try {
      const modulo = zz ?? (await cargar());
      // Respeta el interruptor de silencio de iPhone y iPad y se mezcla con la música de otras apps.
      const audioSession = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
      if (audioSession) {
        audioSession.type = "ambient";
        sesion = audioSession.type;
      }
      await modulo.ZZFX.audioContext.resume();
      if (muestras.arranque === undefined) {
        for (const tipo of Object.keys(EFECTOS) as TipoSonido[]) muestras[tipo] = modulo.ZZFX.buildSamples(...EFECTOS[tipo]);
      }
      zz = modulo;
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      activando = null;
      avisar();
    }
  })();
  return activando;
}

function alVolver(): void {
  const ctx = zz?.ZZFX.audioContext;
  if (!ctx) return;
  if (document.visibilityState === "hidden") void ctx.suspend().catch(() => {});
  else if (encendido) void ctx.resume().catch(() => {});
}

function esperarGesto(): void {
  if (esperandoGesto) return;
  esperandoGesto = true;
  const al = () => {
    document.removeEventListener("pointerdown", al, true);
    document.removeEventListener("keydown", al, true);
    esperandoGesto = false;
    if (encendido) void activar();
  };
  document.addEventListener("pointerdown", al, true);
  document.addEventListener("keydown", al, true);
}

/** Aplica el ajuste guardado al cargar. No toca el audio: espera al primer gesto. */
export function iniciarSonido(guardado: boolean, persistir: (encendido: boolean) => void): void {
  alGuardar = persistir;
  encendido = guardado;
  if (!visibilidadPuesta) {
    visibilidadPuesta = true;
    document.addEventListener("visibilitychange", alVolver);
  }
  if (encendido && zz === null) esperarGesto();
  avisar();
}

/** El toque del altavoz es un gesto: activa el audio en el mismo momento. */
export function alternarSonido(): void {
  encendido = !encendido;
  if (encendido) void activar();
  else void zz?.ZZFX.audioContext.suspend().catch(() => {});
  alGuardar?.(encendido);
  avisar();
}

export function sonar(tipo: TipoSonido, opciones: { ritmo: RitmoSonido; generacion?: number }): void {
  const d = decidir(politica, { tipo, encendido, ritmo: opciones.ritmo, ahora: performance.now(), generacion: opciones.generacion });
  if (!d.suena) return;
  const m = muestras[tipo];
  // Sin gesto previo no hay contexto en marcha: el evento se pierde en silencio y no cuenta ni gasta la separación.
  if (!zz || !m || zz.ZZFX.audioContext.state !== "running") return;
  politica = d.estado;
  try {
    zz.ZZFX.playSamples([m]);
    contadores[tipo]++;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  avisar();
}
