import { PHYSICS_VERSION, type CarResult } from "@/sim/constants";
import { genomeHash, type Genome } from "@/sim/genome";
import { getTrack, TRACKS, type TrackId } from "@/sim/tracks";
import { CELL_COUNT } from "@/evolution/species";
import {
  emptyRankings,
  KEY_GARAGE,
  KEY_RANKINGS,
  KEY_SPECIES,
  normalizeRanking,
  validateGarage,
  validateRankings,
  validateSpecies,
  type Rankings,
  type SavedCar,
  type SpeciesArchives,
  type VersionMarca,
} from "./schema";
import { actualizarClave, epocaActual, leerClave } from "./store";

/** Intentos por elemento antes de conservarlo tal cual, rotulado «no se pudo volver a medir». */
export const MAX_INTENTOS = 3;
/** Tiempo de pantalla visible que puede tardar una medida antes de contar como fallo. */
export const TOPE_MEDIDA_MS = 60_000;
/** Cota del número de medidas de una migración: 10 por ranking, 60 del garaje y las celdas de especies, por pista. */
export const cotaMedidas = (pistas: number): number => (10 + 60 + CELL_COUNT) * pistas;

export type TipoTrabajo = "ranking" | "garaje" | "especie";

export interface TrabajoMigracion {
  clave: string;
  tipo: TipoTrabajo;
  trackId: TrackId;
  /** carId del ranking, id del coche del garaje o carId de la celda. */
  carId: string;
  genome: Genome;
  genomeHash: string;
  /** Versión con la que está medido hoy el elemento; la escritura solo se aplica mientras siga igual. */
  viejo: VersionMarca | null;
  /** Celda de especies. */
  indice?: number;
}

export interface DatosMigrables {
  rankings: Rankings;
  garage: SavedCar[];
  species: SpeciesArchives;
}

export const claveTrabajo = (tipo: TipoTrabajo, trackId: TrackId, id: string | number): string => `${tipo}/${trackId}/${id}`;

const esVigente = (v: VersionMarca | null | undefined, trackId: TrackId): boolean =>
  !!v && v.trackVersion === getTrack(trackId)?.version && v.physicsVersion === PHYSICS_VERSION;

const mismaVersion = (a: VersionMarca | null, b: VersionMarca | null): boolean =>
  a === b || (!!a && !!b && a.trackVersion === b.trackVersion && a.physicsVersion === b.physicsVersion);

/**
 * Todo elemento sin versión actual: entradas de ranking, marcas del garaje sin versión o de otra, y celdas de
 * especies de un archivo antiguo. El linaje no entra: queda como historia. `conservados` son los que ya agotaron
 * sus intentos y no vuelven a entrar.
 */
export function trabajoPendiente(datos: DatosMigrables, conservados: ReadonlySet<string> = new Set()): TrabajoMigracion[] {
  const out: TrabajoMigracion[] = [];
  const meter = (t: TrabajoMigracion) => {
    if (!conservados.has(t.clave)) out.push(t);
  };
  for (const track of TRACKS) {
    for (const e of datos.rankings[track.id] ?? []) {
      const v = { trackVersion: e.trackVersion, physicsVersion: e.physicsVersion };
      if (!esVigente(v, track.id)) {
        meter({ clave: claveTrabajo("ranking", track.id, e.carId), tipo: "ranking", trackId: track.id, carId: e.carId, genome: e.genome, genomeHash: e.genomeHash, viejo: v });
      }
    }
    for (const c of datos.garage) {
      if (c.marks[track.id] === undefined) continue;
      const v = c.markVersions?.[track.id] ?? null;
      if (!esVigente(v, track.id)) {
        meter({ clave: claveTrabajo("garaje", track.id, c.id), tipo: "garaje", trackId: track.id, carId: c.id, genome: c.genome, genomeHash: genomeHash(c.genome), viejo: v });
      }
    }
    const archivo = datos.species[track.id];
    if (archivo && !esVigente(archivo, track.id)) {
      const viejo = { trackVersion: archivo.trackVersion, physicsVersion: archivo.physicsVersion };
      archivo.cells.forEach((c, indice) => {
        if (!c || esVigente(c.trackVersion === undefined ? null : { trackVersion: c.trackVersion, physicsVersion: c.physicsVersion ?? -1 }, track.id)) return;
        meter({ clave: claveTrabajo("especie", track.id, indice), tipo: "especie", trackId: track.id, carId: c.carId, genome: c.genome, genomeHash: genomeHash(c.genome), viejo, indice });
      });
    }
  }
  return out;
}

/** Un archivo de especies de otra versión sin ninguna celda no tiene qué medir: se trata como si no existiera. */
export function archivoVigente(a: SpeciesArchives[TrackId]): boolean {
  return !a || esVigente(a, a.trackId) || a.cells.every((c) => c === null);
}

// --- Aplicar una medida: comparar-y-escribir, atómico por clave. Devuelve si llegó a escribir.

type Medida = CarResult;
const versionNueva = (m: Medida): VersionMarca => ({ trackVersion: m.trackVersion, physicsVersion: m.physicsVersion });

async function aplicarRanking(t: TrabajoMigracion, m: Medida): Promise<boolean> {
  let aplicado = false;
  await actualizarClave(KEY_RANKINGS, (raw) => {
    if (raw === undefined) return raw;
    const rankings = validateRankings(raw) ?? emptyRankings();
    const lista = rankings[t.trackId];
    const i = lista.findIndex((e) => e.carId === t.carId && e.genomeHash === t.genomeHash);
    const e = lista[i];
    if (!e || !mismaVersion({ trackVersion: e.trackVersion, physicsVersion: e.physicsVersion }, t.viejo)) return raw;
    aplicado = true;
    // Una anomalía descalifica: ya no puede estar en el ranking. La fecha, el nombre y el origen se conservan.
    const resto = lista.filter((_, j) => j !== i);
    rankings[t.trackId] = normalizeRanking(m.reason === "anomaly" ? resto : [...resto, { ...e, distance: m.distance, ...versionNueva(m) }]);
    return rankings;
  });
  return aplicado;
}

async function aplicarGaraje(t: TrabajoMigracion, m: Medida): Promise<boolean> {
  let aplicado = false;
  await actualizarClave(KEY_GARAGE, (raw) => {
    if (raw === undefined) return raw;
    const garage = validateGarage(raw) ?? [];
    const c = garage.find((x) => x.id === t.carId && genomeHash(x.genome) === t.genomeHash);
    if (!c || c.marks[t.trackId] === undefined || !mismaVersion(c.markVersions?.[t.trackId] ?? null, t.viejo)) return raw;
    aplicado = true;
    if (m.reason === "anomaly") {
      delete c.marks[t.trackId];
      if (c.markVersions) delete c.markVersions[t.trackId];
    } else {
      c.marks[t.trackId] = m.distance;
      c.markVersions = { ...c.markVersions, [t.trackId]: versionNueva(m) };
    }
    return garage;
  });
  return aplicado;
}

async function aplicarEspecie(t: TrabajoMigracion, m: Medida): Promise<boolean> {
  let aplicado = false;
  await actualizarClave(KEY_SPECIES, (raw) => {
    if (raw === undefined) return raw;
    const especies = validateSpecies(raw) ?? {};
    const archivo = especies[t.trackId];
    const celda = t.indice === undefined ? null : archivo?.cells[t.indice];
    if (!archivo || !celda || celda.carId !== t.carId || !mismaVersion({ trackVersion: archivo.trackVersion, physicsVersion: archivo.physicsVersion }, t.viejo)) return raw;
    aplicado = true;
    const nueva = versionNueva(m);
    // La celda no cambia de sitio: su genoma es el mismo, así que cellIndex sigue siendo su índice.
    archivo.cells[t.indice as number] = m.reason === "anomaly" ? null : { ...celda, distance: m.distance, ...nueva };
    if (archivo.cells.every((c) => c === null || (c.trackVersion === nueva.trackVersion && c.physicsVersion === nueva.physicsVersion))) {
      archivo.trackVersion = nueva.trackVersion;
      archivo.physicsVersion = nueva.physicsVersion;
      archivo.cells = archivo.cells.map((c) => (c ? { carId: c.carId, genome: c.genome, distance: c.distance, batch: c.batch } : null));
    }
    return especies;
  });
  return aplicado;
}

const APLICAR: Record<TipoTrabajo, (t: TrabajoMigracion, m: Medida) => Promise<boolean>> = {
  ranking: aplicarRanking,
  garaje: aplicarGaraje,
  especie: aplicarEspecie,
};

export async function leerMigrables(): Promise<DatosMigrables> {
  const [r, g, s] = await Promise.all([leerClave(KEY_RANKINGS), leerClave(KEY_GARAGE), leerClave(KEY_SPECIES)]);
  return {
    rankings: (r === undefined ? null : validateRankings(r)) ?? emptyRankings(),
    garage: (g === undefined ? null : validateGarage(g)) ?? [],
    species: (s === undefined ? null : validateSpecies(s)) ?? {},
  };
}

// --- Medida con tope de tiempo visible

export type Medir = (genome: Genome, trackId: TrackId, senal: AbortSignal) => Promise<CarResult>;

/** Lo único que la migración pide al navegador, para poder probarla con un reloj falso. */
export interface EntornoMigracion {
  ahora(): number;
  visible(): boolean;
  /** Avisa de cada cambio de visibilidad; devuelve cómo dejar de avisar. */
  alCambiarVisibilidad(cb: () => void): () => void;
  /** Llama a `cb` cada `ms` de tiempo real; devuelve cómo pararlo. */
  cada(ms: number, cb: () => void): () => void;
}

export function entornoNavegador(): EntornoMigracion {
  return {
    ahora: () => Date.now(),
    visible: () => typeof document === "undefined" || document.visibilityState === "visible",
    alCambiarVisibilidad(cb) {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    cada(ms, cb) {
      const id = setInterval(cb, ms);
      return () => clearInterval(id);
    },
  };
}

type Medicion = { ok: true; resultado: CarResult } | { ok: false; motivo: "oculta" | "tope" | "error" };

/**
 * El tope cuenta solo el tiempo con la página visible: con ella oculta el navegador congela el worker y una
 * medida «lenta» no ha fallado. Al ocultarse se descarta la medida en vuelo (motivo «oculta»), que no gasta intento.
 */
function medirConTope(medir: Medir, t: TrabajoMigracion, entorno: EntornoMigracion, topeMs: number): Promise<Medicion> {
  return new Promise((resolver) => {
    const control = new AbortController();
    let visibleMs = 0;
    let ultimo = entorno.ahora();
    let cerrado = false;
    const cerrar = (r: Medicion) => {
      if (cerrado) return;
      cerrado = true;
      pararReloj();
      quitarVisibilidad();
      if (!r.ok) control.abort();
      resolver(r);
    };
    const contar = () => {
      const ahora = entorno.ahora();
      if (entorno.visible()) visibleMs += Math.max(0, ahora - ultimo);
      ultimo = ahora;
      if (visibleMs >= topeMs) cerrar({ ok: false, motivo: "tope" });
    };
    const pararReloj = entorno.cada(1000, contar);
    const quitarVisibilidad = entorno.alCambiarVisibilidad(() => {
      contar();
      if (!entorno.visible()) cerrar({ ok: false, motivo: "oculta" });
    });
    medir(t.genome, t.trackId, control.signal).then(
      (resultado) => cerrar({ ok: true, resultado }),
      () => cerrar({ ok: false, motivo: "error" }),
    );
  });
}

// --- Migración

export interface EstadoMigracion {
  enCurso: boolean;
  hechos: number;
  total: number;
  enVuelo: string | null;
  intentos: Record<string, number>;
  /** Claves conservadas tras agotar los intentos. */
  conservados: string[];
}

export interface OpcionesMigrar {
  medir: Medir;
  entorno?: EntornoMigracion;
  topeMs?: number;
  /** Pestañas abiertas con una versión sin el saludo actual; si hay alguna, no se empieza. */
  pestanasAntiguas?: () => Promise<number>;
  alProgreso?: (e: EstadoMigracion) => void;
  /** Para cancelar entera (salir de la pantalla, importar una copia). */
  senal?: AbortSignal;
  /** Resultados ya conocidos del mismo (genoma, pista) en esta pasada. */
  intentos?: Record<string, number>;
}

export interface ResumenMigracion {
  estado: "completa" | "esperando-pestanas" | "cancelada" | "sin-trabajo";
  medidos: number;
  conservados: string[];
}

const clavePrueba = (t: TrabajoMigracion): string => `${t.genomeHash}|${t.trackId}`;

/**
 * Vuelve a medir, de uno en uno, lo que no tiene la versión actual. Reanudable e idempotente: cada medida se
 * escribe con comparar-y-escribir sobre el elemento y la versión antigua, así que repetirla o interrumpirla no
 * duplica ni pierde nada, y una importación a mitad (época nueva) descarta la medida que estaba en vuelo.
 */
export async function migrar(opts: OpcionesMigrar): Promise<ResumenMigracion> {
  const entorno = opts.entorno ?? entornoNavegador();
  const topeMs = opts.topeMs ?? TOPE_MEDIDA_MS;
  const intentos = opts.intentos ?? {};
  const conservados = new Set<string>(Object.keys(intentos).filter((k) => intentos[k] >= MAX_INTENTOS));
  const resultados = new Map<string, CarResult>();
  let medidos = 0;

  let pendiente = trabajoPendiente(await leerMigrables(), conservados);
  if (pendiente.length === 0) return { estado: "sin-trabajo", medidos: 0, conservados: [...conservados] };
  if (opts.pestanasAntiguas && (await opts.pestanasAntiguas()) > 0) {
    return { estado: "esperando-pestanas", medidos: 0, conservados: [...conservados] };
  }

  const informar = (enVuelo: string | null, total: number) =>
    opts.alProgreso?.({ enCurso: true, hechos: medidos, total, enVuelo, intentos: { ...intentos }, conservados: [...conservados] });

  while (pendiente.length > 0) {
    if (opts.senal?.aborted) return { estado: "cancelada", medidos, conservados: [...conservados] };
    // Con la página oculta no se mide: se espera a volver.
    if (!entorno.visible()) {
      await new Promise<void>((seguir) => {
        const quitar = entorno.alCambiarVisibilidad(() => {
          if (entorno.visible()) {
            quitar();
            seguir();
          }
        });
        opts.senal?.addEventListener("abort", () => {
          quitar();
          seguir();
        });
      });
      continue;
    }
    const t = pendiente[0];
    informar(t.clave, medidos + pendiente.length);
    const epoca = epocaActual();
    const conocido = resultados.get(clavePrueba(t));
    const medicion: Medicion = conocido ? { ok: true, resultado: conocido } : await medirConTope(opts.medir, t, entorno, topeMs);
    if (opts.senal?.aborted) return { estado: "cancelada", medidos, conservados: [...conservados] };

    if (medicion.ok) {
      const r = medicion.resultado;
      resultados.set(clavePrueba(t), r);
      // Una época nueva (importación) cambió lo guardado por debajo: lo medido ya no vale, se recalcula lo pendiente.
      if (epoca !== epocaActual()) resultados.clear();
      else if (await APLICAR[t.tipo](t, r)) medidos += 1;
      // Un elemento que no deja escribir (cambió por debajo) gasta intento: así el bucle siempre acaba.
      else intentos[t.clave] = (intentos[t.clave] ?? 0) + 1;
    } else if (medicion.motivo !== "oculta") {
      intentos[t.clave] = (intentos[t.clave] ?? 0) + 1;
      if (intentos[t.clave] >= MAX_INTENTOS) conservados.add(t.clave);
    }
    pendiente = trabajoPendiente(await leerMigrables(), conservados);
  }
  opts.alProgreso?.({ enCurso: false, hechos: medidos, total: medidos, enVuelo: null, intentos: { ...intentos }, conservados: [...conservados] });
  return { estado: "completa", medidos, conservados: [...conservados] };
}
