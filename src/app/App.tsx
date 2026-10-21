"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { instalarGanchos, registrarManejadores, runtime, type Escenario } from "@/debug/ganchos";
import { markInput } from "@/debug/latencias";
import { evolucionDemo, evolucionSintetica, type EscenarioEvolucion } from "@/debug/escenario-evolucion";
import { DEFAULT_PARAMS, seedPopulation, type EvolutionState, type GaParams } from "@/evolution/ga";
import type { SpeciesArchive, SpeciesCell } from "@/evolution/species";
import { mergeLineage, originOf, pruneLineage, type LineageNode } from "@/evolution/lineage";
import { createSimRunner } from "@/worker";
import { PHYSICS_VERSION, type CarResult } from "@/sim/constants";
import { genomeHash, normalizeGenome, STOCK_CAR, type Genome } from "@/sim/genome";
import { DEFAULT_TRACK_ID, getTrack, TRACKS, type TrackId } from "@/sim/tracks";
import { DEFAULT_META, loadMeta, META_KEY, saveMeta, type Meta, type RitmoRecordado } from "@/storage/meta";
import {
  emptyRankings,
  KEY_EVOLUTION,
  KEY_GARAGE,
  KEY_LINEAGE,
  KEY_RANKINGS,
  KEY_SPECIES,
  validateEvolution,
  validateGarage,
  validateLineage,
  validateRankings,
  validateSpecies,
  type RankingEntry,
  type Rankings,
  type SavedCar,
  type SpeciesArchives,
} from "@/storage/schema";
import {
  GARAGE_FULL_MESSAGE,
  loadAll,
  recordMark,
  removeFromGarage,
  save,
  saveToGarage,
  updateRanking,
  type RankingOutcome,
} from "@/storage/store";
import { Evolucion, type Campeon } from "./components/Evolucion";
import { Especies } from "./components/Especies";
import { Explorar } from "./components/Explorar";
import { Garaje } from "./components/Garaje";
import { InicioEvolucion, nuevaSemilla, type Siembra } from "./components/InicioEvolucion";
import { Linaje } from "./components/Linaje";
import { Pista } from "./components/Pista";
import { Portada } from "./components/Portada";
import { Rankings as PantallaRankings } from "./components/Rankings";
import { AvisoMigracion, BandaMigracion, EsperaPestanas } from "./components/BandaMigracion";
import { useMigracion } from "./useMigracion";
import { recargarAntiguas, saludar } from "@/pwa/pestanas";
import { BotonAyuda, ComoSeJuega, PanelAyuda } from "./components/CapasAyuda";
import { useCapas } from "./ayuda/capas";
import { Taller } from "./components/Taller";
import { medirEnTodasLasPistas, type MedicionEnCurso } from "./medir-pistas";
import { resumenMedicion } from "./ranking-text";

type Pantalla = "portada" | "explorar" | "pista" | "taller" | "garaje" | "rankings" | "evolucion-inicio" | "evolucion" | "linaje" | "especies";

export const SIN_GUARDADO =
  "Este navegador no deja guardar. Puedes jugar, pero los rankings y el garaje se perderán al cerrar.";
const GUARDADO_OK = "Guardado en este dispositivo";

function publicar(r: Rankings): void {
  for (const id of Object.keys(r) as TrackId[]) {
    runtime.rankings[id] = r[id].map((e) => ({ carId: e.carId, distance: e.distance, origin: e.origin }));
  }
}

function esGenoma(v: unknown): v is Genome {
  return typeof v === "object" && v !== null && "body" in v && !("genome" in v);
}

export function App() {
  const [screen, setScreen] = useState<Pantalla>("portada");
  const [especies, setEspecies] = useState<SpeciesArchives>({});
  const especiesRef = useRef<SpeciesArchives>({});
  // De dónde se abrió la pista: «Volver» regresa allí.
  const [origenPista, setOrigenPista] = useState<Pantalla>("portada");
  const [trackId, setTrackId] = useState<TrackId>(DEFAULT_TRACK_ID);
  const [meta, setMeta] = useState<Meta>(DEFAULT_META);
  const [rankings, setRankings] = useState<Rankings>(emptyRankings());
  const [garage, setGarage] = useState<SavedCar[]>([]);
  // Pista cuyo ranking se abre; «Ver correr» la deja puesta para volver a la misma pestaña.
  const [pistaRanking, setPistaRanking] = useState<TrackId>(DEFAULT_TRACK_ID);
  const [midiendo, setMidiendo] = useState<{ carId: string; n: number; total: number } | null>(null);
  const [resumenes, setResumenes] = useState<Record<string, string>>({});
  const medicion = useRef<MedicionEnCurso<RankingOutcome> | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [workshopGenome, setWorkshopGenome] = useState<Genome>(STOCK_CAR);
  // El genoma que se manda a la pista; null = el coche de serie de «Ver el coche de serie».
  const [trial, setTrial] = useState<{ genome: Genome; origin: SavedCar["origin"] } | null>(null);
  // Evolución en curso (la que se guarda tras cada generación) y de dónde sale el coche que la siembra.
  const [evolucion, setEvolucion] = useState<EvolutionState | null>(null);
  const [evolKey, setEvolKey] = useState(0);
  const [desdeCoche, setDesdeCoche] = useState<SavedCar | null>(null);
  const lineageRef = useRef<LineageNode[]>([]);
  // Foto del linaje para la pantalla Linaje: se toma al abrirla, no en cada generación.
  const [linajeNodos, setLinajeNodos] = useState<LineageNode[]>([]);
  const [linajeSel, setLinajeSel] = useState<string | null>(null);
  const [linajeNodo, setLinajeNodo] = useState<string | null>(null);
  // Coche con linaje que se abrió en el taller: si se evoluciona retocado, el retoque cuelga del original.
  const origenTaller = useRef<{ lineageId: string; hash: string } | null>(null);
  const evolucionRef = useRef<EvolutionState | null>(null);
  const rankingsRef = useRef(rankings);
  const garageRef = useRef(garage);
  const metaRef = useRef(meta);
  const genomeRef = useRef(workshopGenome);
  useEffect(() => {
    metaRef.current = meta;
    genomeRef.current = workshopGenome;
    rankingsRef.current = rankings;
    garageRef.current = garage;
    evolucionRef.current = evolucion;
  });

  const chooseTrack = useCallback((id: TrackId) => {
    setTrackId(id);
    runtime.pistaSeleccionada = id;
    setMeta((m) => {
      const next = { ...m, lastTrack: id };
      void saveMeta(next);
      return next;
    });
  }, []);

  const recordarRitmo = useCallback((ritmo: RitmoRecordado) => {
    setMeta((m) => {
      if (m.ritmo === ritmo) return m;
      const next = { ...m, ritmo };
      void saveMeta(next);
      return next;
    });
  }, []);

  const aplicarRankings = useCallback((r: Rankings) => {
    publicar(r);
    setRankings(r);
  }, []);

  const aplicarGaraje = useCallback((g: SavedCar[]) => {
    runtime.garaje = g.length;
    setGarage(g);
  }, []);

  const recargar = useCallback(async () => {
    const { data, available } = await loadAll();
    runtime.disponible = available;
    const r = (data[KEY_RANKINGS] as Rankings | undefined) ?? emptyRankings();
    const g = (data[KEY_GARAGE] as SavedCar[] | undefined) ?? [];
    rankingsRef.current = r;
    garageRef.current = g;
    aplicarRankings(r);
    aplicarGaraje(g);
  }, [aplicarRankings, aplicarGaraje]);

  const migracion = useMigracion(recargar);
  const iniciarMigracion = migracion.iniciar;
  const [tarjetaFin, setTarjetaFin] = useState(false);

  // Cada pestaña avisa de que existe, para que una migración no empiece con otra de versión antigua abierta.
  useEffect(() => {
    const quitar = saludar();
    void iniciarMigracion();
    return quitar;
  }, [iniciarMigracion]);

  const aplicarEspecies = useCallback((s: SpeciesArchives) => {
    especiesRef.current = s;
    setEspecies(s);
  }, []);

  // Cada lote deja guardado el archivo de su pista; los de las otras pistas no se tocan.
  const guardarEspecies = useCallback(
    async (archive: SpeciesArchive) => {
      const todo: SpeciesArchives = { ...especiesRef.current, [archive.trackId]: archive };
      await save(KEY_SPECIES, todo);
      aplicarEspecies(todo);
    },
    [aplicarEspecies],
  );

  const aplicarEvolucion = useCallback((state: EvolutionState | null) => {
    evolucionRef.current = state;
    setEvolucion(state);
  }, []);

  const releerTodo = useCallback(async () => {
    const { data, available } = await loadAll();
    runtime.disponible = available;
    const r = (data[KEY_RANKINGS] as Rankings | undefined) ?? emptyRankings();
    const g = (data[KEY_GARAGE] as SavedCar[] | undefined) ?? [];
    rankingsRef.current = r;
    garageRef.current = g;
    aplicarRankings(r);
    aplicarGaraje(g);
    const nodos = (data[KEY_LINEAGE] as LineageNode[] | undefined) ?? [];
    lineageRef.current = nodos;
    setLinajeNodos(nodos);
    setLinajeSel(null);
    setLinajeNodo(null);
    origenTaller.current = null;
    aplicarEspecies((data[KEY_SPECIES] as SpeciesArchives | undefined) ?? {});
    aplicarEvolucion((data[KEY_EVOLUTION] as EvolutionState | undefined) ?? null);
    const m = (data[META_KEY] as Meta | undefined) ?? DEFAULT_META;
    setMeta(m);
    setTrackId(m.lastTrack);
    runtime.pistaSeleccionada = m.lastTrack;
    runtime.ultimaInscripcion = null;
    // Una copia importada puede traer marcas de otra versión: se migran igual que al cargar.
    void iniciarMigracion();
  }, [aplicarRankings, aplicarGaraje, aplicarEspecies, aplicarEvolucion, iniciarMigracion]);

  // El linaje se poda protegiendo lo que alguien puede volver a abrir: la población viva, los favoritos,
  // los mejores de cada generación y los coches de los rankings y del garaje.
  const guardarEvolucion = useCallback(
    async (state: EvolutionState, added: LineageNode[]) => {
      const protegidos = [
        ...state.population.map((p) => p.id),
        ...state.favorites,
        ...state.history.map((h) => h.bestId),
        ...Object.values(rankingsRef.current).flatMap((lista) => lista.flatMap((e) => (e.lineageId ? [e.lineageId] : []))),
        ...garageRef.current.flatMap((c) => (c.lineageId ? [c.lineageId] : [])),
      ];
      lineageRef.current = pruneLineage(mergeLineage(lineageRef.current, added), protegidos);
      await save(KEY_EVOLUTION, state);
      await save(KEY_LINEAGE, lineageRef.current);
      aplicarEvolucion(state);
    },
    [aplicarEvolucion],
  );

  const lanzarEvolucion = useCallback(
    async (params: GaParams, id: TrackId, from: Parameters<typeof seedPopulation>[2]) => {
      const { state, lineageAdded } = seedPopulation(params, id, from);
      await guardarEvolucion(state, lineageAdded);
      setEvolKey((k) => k + 1);
      setScreen("evolucion");
    },
    [guardarEvolucion],
  );

  const evolucionarDesdeTaller = useCallback(() => {
    const origen = origenTaller.current;
    origenTaller.current = null;
    // Solo cuelga de un nodo que sigue en el linaje; si se podó, el retoque empieza un árbol nuevo.
    const padre = origen && lineageRef.current.some((n) => n.id === origen.lineageId) ? origen : null;
    const item = padre
      ? { genome: genomeRef.current, sourceId: padre.lineageId, op: genomeHash(genomeRef.current) === padre.hash ? ("clone" as const) : ("retouch" as const) }
      : { genome: genomeRef.current, op: "design" as const };
    void lanzarEvolucion({ ...DEFAULT_PARAMS, seed: nuevaSemilla() }, trackId, { kind: "genomes", items: [item] });
  }, [lanzarEvolucion, trackId]);

  const empezarEvolucion = useCallback(
    (params: GaParams, siembra: Siembra, coche: SavedCar | null) => {
      const items =
        siembra === "mi-coche"
          ? [{ genome: genomeRef.current, op: "design" as const }]
          : siembra === "garaje"
            ? (coche ? [coche] : garageRef.current).map((c) => ({ genome: c.genome, sourceId: c.lineageId, op: "clone" as const }))
            : null;
      void lanzarEvolucion(params, trackId, items ? { kind: "genomes", items } : { kind: "random" });
    },
    [lanzarEvolucion, trackId],
  );

  // Inscribe al campeón de la generación en el ranking de la pista de la evolución, con su origen real.
  const onGeneracion = useCallback(
    async (state: EvolutionState, added: LineageNode[], campeon: Campeon | null): Promise<RankingOutcome | null> => {
      await guardarEvolucion(state, added);
      if (!campeon) return null;
      const origin = originOf(campeon.individual.id, lineageRef.current);
      const outcome = await updateRanking({
        result: campeon.result,
        genome: campeon.individual.genome,
        origin,
        lineageId: campeon.individual.id,
      });
      await recordMark(campeon.result.carId, campeon.result.trackId, campeon.result.distance, { trackVersion: campeon.result.trackVersion, physicsVersion: campeon.result.physicsVersion });
      runtime.ultimaInscripcion = {
        trackId: campeon.result.trackId,
        position: outcome.position,
        alreadyAt: outcome.alreadyAt,
        isRecord: outcome.isRecord,
      };
      await recargar();
      return outcome;
    },
    [guardarEvolucion, recargar],
  );

  const onGuardarCampeon = useCallback(
    async (campeon: Campeon): Promise<string> => {
      const { individual, result } = campeon;
      const existente = garageRef.current.find((c) => c.id === result.carId);
      const marks: SavedCar["marks"] = { ...(existente?.marks ?? {}) };
      marks[result.trackId] = Math.max(marks[result.trackId] ?? 0, result.distance);
      const car: SavedCar = {
        id: genomeHash(individual.genome),
        name: existente?.name ?? `Campeón gen ${campeon.generation}`,
        genome: individual.genome,
        marks,
        origin: originOf(individual.id, lineageRef.current),
        savedAt: new Date().toISOString(),
        lineageId: individual.id,
      };
      const r = await saveToGarage(car);
      if (!r.ok) return GARAGE_FULL_MESSAGE;
      await recargar();
      return runtime.disponible ? GUARDADO_OK : "Guardado, pero solo hasta que cierres la pestaña.";
    },
    [recargar],
  );

  const editar = useCallback((g: Genome) => {
    const n = normalizeGenome(g);
    runtime.genomaEnTaller = n;
    setWorkshopGenome(n);
  }, []);

  const abrirEnTaller = useCallback(
    (genome: Genome, lineageId?: string) => {
      editar(genome);
      origenTaller.current = lineageId ? { lineageId, hash: genomeHash(normalizeGenome(genome)) } : null;
      setScreen("taller");
    },
    [editar],
  );

  const abrirLinaje = useCallback(() => {
    setLinajeNodos(lineageRef.current);
    setLinajeNodo(null);
    setScreen("linaje");
  }, []);

  useEffect(() => {
    instalarGanchos();
    loadMeta().then(({ meta: loaded, warning: w, available }) => {
      setMeta(loaded);
      setTrackId(loaded.lastTrack);
      runtime.pistaSeleccionada = loaded.lastTrack;
      runtime.disponible = available;
      // Sin almacén se avisa una sola vez, con el texto único del producto.
      setWarning(available ? w : SIN_GUARDADO);
    });
    // Un escenario cargado mientras esta lectura inicial seguía en vuelo manda: no se pisa con lo anterior.
    let escenarioCargado = false;
    loadAll().then(({ data }) => {
      if (escenarioCargado) return;
      const r = (data[KEY_RANKINGS] as Rankings | undefined) ?? emptyRankings();
      const g = (data[KEY_GARAGE] as SavedCar[] | undefined) ?? [];
      rankingsRef.current = r;
      garageRef.current = g;
      aplicarRankings(r);
      aplicarGaraje(g);
      lineageRef.current = (data[KEY_LINEAGE] as LineageNode[] | undefined) ?? [];
      aplicarEspecies((data[KEY_SPECIES] as SpeciesArchives | undefined) ?? {});
      aplicarEvolucion((data[KEY_EVOLUTION] as EvolutionState | undefined) ?? null);
    });
    registrarManejadores({
      async cargarEscenario(e: Escenario) {
        escenarioCargado = true;
        // Un escenario vacío limpia lo que el juego guarda; el resto se reescribe igual que el juego.
        const base = e.vacio ? DEFAULT_META : undefined;
        const pista = getTrack(e.pista)?.id ?? base?.lastTrack;
        if (base || pista) {
          const m = { ...(base ?? DEFAULT_META), lastTrack: pista ?? DEFAULT_TRACK_ID };
          await saveMeta(m);
          setMeta(m);
          setTrackId(m.lastTrack);
          runtime.pistaSeleccionada = m.lastTrack;
        }
        if (e.vacio) {
          await save(KEY_RANKINGS, null);
          await save(KEY_GARAGE, null);
          aplicarRankings(emptyRankings());
          aplicarGaraje([]);
          runtime.ultimaInscripcion = null;
          await save(KEY_EVOLUTION, null);
          await save(KEY_LINEAGE, null);
          await save(KEY_SPECIES, null);
          aplicarEspecies({});
          lineageRef.current = [];
          setLinajeNodos([]);
          origenTaller.current = null;
          aplicarEvolucion(null);
          editar(STOCK_CAR);
        }
        if (e.evolucion !== undefined) {
          const pistaPorDefecto = getTrack(e.pista)?.id ?? DEFAULT_TRACK_ID;
          const estado =
            e.evolucion === "demo-gen-8"
              ? await evolucionDemo()
              : typeof e.evolucion === "object" && e.evolucion !== null
                ? evolucionSintetica(e.evolucion as EscenarioEvolucion, pistaPorDefecto)
                : null;
          if (!estado || !validateEvolution(estado)) throw new Error("escenario con evolución inválida");
          await save(KEY_EVOLUTION, estado);
          aplicarEvolucion(estado);
        }
        if (e.especies !== undefined) {
          const datos =
            e.especies === "demo"
              ? JSON.parse((await import("@/debug/escenarios/especies-demo.texto")).default)
              : e.especies === "demo-version-anterior"
                ? await (await import("@/debug/escenarios/version-anterior")).especiesVersionAnterior()
                : e.especies;
          const validos = validateSpecies(datos);
          if (!validos) throw new Error("escenario con especies inválidas");
          await save(KEY_SPECIES, validos);
          aplicarEspecies(validos);
        }
        if (e.rankings === "demo" || e.rankings === "demo-version-anterior" || (typeof e.rankings === "object" && e.rankings !== null)) {
          // El JSON de demostración solo se descarga cuando un escenario lo pide.
          const datos =
            e.rankings === "demo"
              ? JSON.parse((await import("@/debug/escenarios/rankings-demo.texto")).default)
              : e.rankings === "demo-version-anterior"
                ? await (await import("@/debug/escenarios/version-anterior")).rankingsVersionAnterior()
                : e.rankings;
          const validos = validateRankings({ ...emptyRankings(), ...datos });
          if (!validos) throw new Error("escenario con rankings inválidos");
          await save(KEY_RANKINGS, validos);
          aplicarRankings(validos);
        }
        if (e.garaje === "demo-version-anterior" || Array.isArray(e.garaje)) {
          const origen = e.garaje === "demo-version-anterior" ? await (await import("@/debug/escenarios/version-anterior")).garajeVersionAnterior() : (e.garaje as unknown[]);
          const coches = origen.map((item, i) =>
            esGenoma(item)
              ? {
                  id: genomeHash(normalizeGenome(item)),
                  name: `Diseño ${i + 1}`,
                  genome: normalizeGenome(item),
                  marks: {},
                  origin: "diseño" as const,
                  savedAt: new Date().toISOString(),
                }
              : item,
          );
          const validos = validateGarage(coches);
          if (!validos) throw new Error("escenario con garaje inválido");
          await save(KEY_GARAGE, validos);
          aplicarGaraje(validos);
        }
        runtime.migracionFrenada = e.migracion === "frenada";
        if (e.linaje !== undefined) {
          const demo =
            e.linaje === "demo-5-generaciones"
              ? (JSON.parse((await import("@/debug/escenarios/linaje-demo-5.texto")).default) as { nodos: unknown; campeon: string })
              : null;
          const nodos = validateLineage(demo ? demo.nodos : e.linaje);
          if (!nodos || nodos.length === 0) throw new Error("escenario con linaje inválido");
          await save(KEY_LINEAGE, nodos);
          lineageRef.current = nodos;
          setLinajeNodos(nodos);
          setLinajeSel(null);
          setLinajeNodo(null);
          // El campeón entra en el ranking de su pista como lo haría una evolución: de ahí cuelga «n.º 1 de …».
          // En el demo es el que señala el escenario (entre clones de igual distancia, el último); si no, el de más metros.
          const medidos = nodos.filter((n) => n.distance !== null && n.trackId !== null);
          const campeon =
            nodos.find((n) => n.id === demo?.campeon) ??
            medidos.reduce<LineageNode | null>((a, n) => (a === null || n.distance! > a.distance! ? n : a), null);
          const track = campeon?.trackId ? getTrack(campeon.trackId) : null;
          if (campeon && track) {
            await updateRanking({
              result: { carId: campeon.id, distance: campeon.distance!, reason: "stall", steps: 0, physicsVersion: PHYSICS_VERSION, trackId: track.id, trackVersion: track.version },
              genome: campeon.genome,
              origin: originOf(campeon.id, nodos),
              lineageId: campeon.id,
            });
            await recargar();
          }
        }
        if (e.genoma !== undefined) editar(normalizeGenome(e.genoma));
        setScreen("portada");
      },
    });
  }, [aplicarRankings, aplicarGaraje, aplicarEvolucion, aplicarEspecies, editar, recargar]);

  useEffect(() => {
    runtime.pantalla = screen === "explorar" ? "pista" : screen === "evolucion-inicio" ? "evolucion" : screen;
  }, [screen]);

  const abrirTaller = useCallback(() => {
    markInput("abrir-pista");
    runtime.genomaEnTaller = genomeRef.current;
    origenTaller.current = null;
    setScreen("taller");
  }, []);

  const probar = useCallback((genome: Genome, origin: SavedCar["origin"], desde: Pantalla) => {
    setTrial({ genome, origin });
    setOrigenPista(desde);
    setScreen("pista");
  }, []);

  // Inscribe la marca de la carrera en el ranking de SU pista y la apunta en el garaje si el coche está guardado.
  const inscribir = useCallback(
    async (result: CarResult): Promise<RankingOutcome | null> => {
      if (!trial) return null;
      const outcome = await updateRanking({ result, genome: trial.genome, origin: trial.origin });
      await recordMark(result.carId, result.trackId, result.distance, { trackVersion: result.trackVersion, physicsVersion: result.physicsVersion });
      runtime.ultimaInscripcion = {
        trackId: result.trackId,
        position: outcome.position,
        alreadyAt: outcome.alreadyAt,
        isRecord: outcome.isRecord,
      };
      await recargar();
      return outcome;
    },
    [trial, recargar],
  );

  const guardarGenoma = useCallback(
    async (genome: Genome, origin: SavedCar["origin"], name?: string, lineageId?: string): Promise<string> => {
      const id = genomeHash(genome);
      const existente = garage.find((c) => c.id === id);
      const marks: SavedCar["marks"] = { ...(existente?.marks ?? {}) };
      for (const t of Object.keys(rankings) as TrackId[]) {
        const entrada = rankings[t].find((r) => r.genomeHash === id);
        if (entrada) marks[t] = Math.max(marks[t] ?? 0, entrada.distance);
      }
      const car: SavedCar = {
        id,
        name: existente?.name ?? name ?? `Diseño ${garage.length + 1}`,
        genome,
        marks,
        origin: existente?.origin ?? origin,
        savedAt: new Date().toISOString(),
      };
      const linaje = existente?.lineageId ?? lineageId;
      if (linaje !== undefined) car.lineageId = linaje;
      const r = await saveToGarage(car);
      if (!r.ok) return GARAGE_FULL_MESSAGE;
      await recargar();
      return runtime.disponible ? GUARDADO_OK : "Guardado, pero solo hasta que cierres la pestaña.";
    },
    [garage, rankings, recargar],
  );

  const guardarCoche = useCallback(() => guardarGenoma(genomeRef.current, "diseño"), [guardarGenoma]);

  const abrirRanking = useCallback((id: TrackId) => {
    markInput("abrir-ranking");
    setPistaRanking(id);
    setScreen("rankings");
  }, []);

  // Corre el coche en las cuatro pistas, una a una y en turbo; cada marca va solo al ranking de su pista.
  const medirCoche = useCallback(
    async (car: SavedCar) => {
      if (medicion.current) return;
      markInput("medir-pistas");
      const runner = createSimRunner();
      setResumenes((r) => Object.fromEntries(Object.entries(r).filter(([id]) => id !== car.id)));
      setMidiendo({ carId: car.id, n: 1, total: TRACKS.length });
      const m = medirEnTodasLasPistas<RankingOutcome>({
        runner,
        carId: car.id,
        genome: car.genome,
        onProgress: (n, total) => setMidiendo({ carId: car.id, n, total }),
        registrar: async (result) => {
          const outcome = await updateRanking({ result, genome: car.genome, origin: car.origin, lineageId: car.lineageId, name: car.name });
          if (result.reason !== "anomaly") await recordMark(car.id, result.trackId, result.distance, { trackVersion: result.trackVersion, physicsVersion: result.physicsVersion });
          return outcome;
        },
      });
      medicion.current = m;
      runtime.avanzar = async (segundos) => {
        await m.avanzar(segundos);
        // Dos frames: el primero aplica el estado y el segundo lo deja pintado.
        await new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));
      };
      let texto: string;
      try {
        texto = resumenMedicion(await m.terminada);
      } catch {
        texto = "La medición falló. Vuelve a intentarlo.";
      }
      runner.terminate();
      medicion.current = null;
      runtime.avanzar = null;
      await recargar();
      setResumenes((r) => ({ ...r, [car.id]: texto }));
      setMidiendo(null);
    },
    [recargar],
  );

  const volverDePista = useCallback(() => setScreen(origenPista), [origenPista]);

  const { capas, abrir: abrirCapa, cerrarArriba } = useCapas();
  const hayCapas = capas.length > 0;
  const habiaCapas = useRef(false);
  const guiaArriba = capas[capas.length - 1]?.tipo === "guia";
  const guiaCapa = capas.find((c) => c.tipo === "guia");
  useEffect(() => {
    runtime.ayudaAbierta = capas.some((c) => c.tipo === "ayuda") ? screen : null;
    runtime.guia = {
      abierta: guiaCapa !== undefined,
      seccion: guiaCapa?.tipo === "guia" ? guiaCapa.seccion : null,
      origen: guiaCapa !== undefined ? screen : null,
    };
    // Al cerrar la última capa el foco vuelve al «?», que es de donde se abrió.
    if (habiaCapas.current && !hayCapas) document.querySelector<HTMLElement>('[data-testid="ayuda-boton"]')?.focus();
    habiaCapas.current = hayCapas;
  }, [capas, guiaCapa, hayCapas, screen]);

  return (
    <>
      {screen === "portada" && (
        <Portada
          rankings={rankings}
          onExplore={() => setScreen("explorar")}
          onStock={() => {
            markInput("abrir-pista");
            setTrial(null);
            setOrigenPista("portada");
            setScreen("pista");
          }}
          onRanking={abrirRanking}
          onTaller={abrirTaller}
          onGarage={() => setScreen("garaje")}
          onGuia={() => abrirCapa({ tipo: "guia", seccion: null })}
          onLinaje={abrirLinaje}
          onEvolucion={() => {
            setDesdeCoche(null);
            setScreen("evolucion-inicio");
          }}
          continuar={
            evolucion ? { generation: evolucion.generation, trackName: getTrack(evolucion.trackId)?.name ?? evolucion.trackId } : null
          }
          onEspecies={() => setScreen("especies")}
          onContinuar={() => {
            setEvolKey((k) => k + 1);
            setScreen("evolucion");
          }}
        />
      )}
      {screen === "explorar" && (
        <Explorar trackId={trackId} onTrack={chooseTrack} onBack={() => setScreen("portada")} rankings={rankings} />
      )}
      {screen === "pista" && (
        <Pista
          // Una carrera nueva (otra pista u otro coche) monta una escena nueva.
          key={`${trackId}:${trial ? genomeHash(trial.genome) : "serie"}`}
          trackId={trackId}
          genome={trial?.genome}
          onFinish={trial ? inscribir : undefined}
          onBack={volverDePista}
          rankings={rankings}
          ritmoInicial={meta.ritmo}
          onRitmo={recordarRitmo}
          migrando={migracion.estado.enCurso}
          onTarjeta={setTarjetaFin}
          pausaCapa={hayCapas}
        />
      )}
      {screen === "rankings" && (
        <PantallaRankings
          rankings={rankings}
          initialTrack={pistaRanking}
          migracion={{ enCurso: migracion.estado.enCurso, conservados: migracion.estado.conservados }}
          onBack={() => setScreen("portada")}
          onWatch={(entry: RankingEntry) => {
            setPistaRanking(entry.trackId);
            chooseTrack(entry.trackId);
            probar(entry.genome, entry.origin, "rankings");
          }}
          onOpenInWorkshop={(entry: RankingEntry) => {
            chooseTrack(entry.trackId);
            abrirEnTaller(entry.genome, entry.lineageId);
          }}
          onSaveToGarage={(entry: RankingEntry) => guardarGenoma(entry.genome, entry.origin, entry.name, entry.lineageId)}
          onTaller={abrirTaller}
          onEvolucion={() => {
            setDesdeCoche(null);
            setScreen("evolucion-inicio");
          }}
        />
      )}
      {screen === "taller" && (
        <Taller
          genome={workshopGenome}
          onGenome={editar}
          trackId={trackId}
          onTrack={chooseTrack}
          rankings={rankings}
          helpSeen={meta.seenHelp.includes("taller")}
          onHelpSeen={() => {
            if (metaRef.current.seenHelp.includes("taller")) return;
            const next = { ...metaRef.current, seenHelp: [...metaRef.current.seenHelp, "taller"] };
            setMeta(next);
            void saveMeta(next);
          }}
          onTry={() => probar(genomeRef.current, "diseño", "taller")}
          onSave={guardarCoche}
          onEvolve={evolucionarDesdeTaller}
          onBack={() => setScreen("portada")}
        />
      )}
      {screen === "garaje" && (
        <Garaje
          cars={garage}
          trackId={trackId}
          onTrack={chooseTrack}
          rankings={rankings}
          onTry={(car) => probar(car.genome, car.origin, "garaje")}
          midiendo={midiendo}
          resumenes={resumenes}
          onMeasure={medirCoche}
          onOpen={(car) => abrirEnTaller(car.genome, car.lineageId)}
          onDelete={async (car) => {
            await removeFromGarage(car.id);
            await recargar();
          }}
          onTaller={abrirTaller}
          onEvolve={(car) => {
            setDesdeCoche(car);
            setScreen("evolucion-inicio");
          }}
          onBack={() => setScreen("portada")}
          almacenDisponible={runtime.disponible}
          onImportada={releerTodo}
        />
      )}
      {screen === "evolucion-inicio" && (
        <InicioEvolucion
          trackId={trackId}
          onTrack={chooseTrack}
          rankings={rankings}
          garage={garage}
          workshopGenome={workshopGenome}
          desdeCoche={desdeCoche}
          onStart={empezarEvolucion}
          onBack={() => setScreen(desdeCoche ? "garaje" : "portada")}
        />
      )}
      {screen === "evolucion" && evolucion && (
        <Evolucion
          key={evolKey}
          initial={evolucion}
          rankings={rankings}
          onGeneracion={onGeneracion}
          onGuardarCampeon={onGuardarCampeon}
          onBack={() => setScreen("portada")}
        />
      )}
      {screen === "especies" && (
        <Especies
          key={trackId}
          trackId={trackId}
          onTrack={chooseTrack}
          rankings={rankings}
          archive={especies[trackId]}
          onArchive={guardarEspecies}
          onWatch={(c, t) => {
            chooseTrack(t);
            probar(c.genome, "evolución", "especies");
          }}
          onOpenInWorkshop={(c) => {
            editar(c.genome);
            setScreen("taller");
          }}
          onSaveToGarage={(c, i, t) =>
            guardarGenoma(c.genome, "evolución", `Especie ${i + 1} · ${getTrack(t)?.name ?? t}`)
          }
          onEvolve={(c: SpeciesCell, t) => {
            chooseTrack(t);
            void lanzarEvolucion({ ...DEFAULT_PARAMS, seed: nuevaSemilla() }, t, {
              kind: "genomes",
              items: [{ genome: c.genome, op: "design" }],
            });
          }}
          onBack={() => setScreen("portada")}
        />
      )}
      {screen === "linaje" && (
        <Linaje
          nodes={linajeNodos}
          rankings={rankings}
          garage={garage}
          evolucion={evolucion}
          seleccion={linajeSel}
          onSeleccion={setLinajeSel}
          nodoId={linajeNodo}
          onNodo={setLinajeNodo}
          onBack={() => setScreen("portada")}
          // La carrera se repite en la pista donde se midió el nodo, no en la que haya elegida.
          onWatch={(n) => {
            if (!n.trackId) return;
            chooseTrack(n.trackId);
            probar(n.genome, originOf(n.id, lineageRef.current), "linaje");
          }}
          onOpenInWorkshop={(n) => {
            if (n.trackId) chooseTrack(n.trackId);
            abrirEnTaller(n.genome, n.id);
          }}
          onSaveToGarage={(n) => guardarGenoma(n.genome, originOf(n.id, lineageRef.current), undefined, n.id)}
          onEvolucion={() => {
            setDesdeCoche(null);
            setScreen("evolucion-inicio");
          }}
        />
      )}
      {migracion.estado.enCurso && <BandaMigracion hechos={migracion.estado.hechos} total={migracion.estado.total} />}
      {migracion.esperando && !migracion.estado.enCurso && (
        <EsperaPestanas
          onRecargar={() => {
            recargarAntiguas();
            void iniciarMigracion();
          }}
        />
      )}
      {migracion.terminadas !== null && !migracion.estado.enCurso && (screen !== "pista" || tarjetaFin) && (
        <AvisoMigracion coches={migracion.terminadas} onCerrar={migracion.cerrarAviso} />
      )}
      <BotonAyuda
        onClick={() => {
          markInput("ayuda");
          abrirCapa({ tipo: "ayuda" });
        }}
      />
      {capas.map((c, i) =>
        c.tipo === "ayuda" ? (
          <PanelAyuda
            key={`ayuda-${i}`}
            pantalla={screen}
            visible={!(guiaArriba && i < capas.length - 1)}
            onCerrar={cerrarArriba}
            onGuia={(seccion) => abrirCapa({ tipo: "guia", seccion })}
          />
        ) : (
          <ComoSeJuega key={`guia-${i}`} seccion={c.seccion} onVolver={cerrarArriba} />
        ),
      )}
      {warning && (
        <div className="aviso" role="status" data-testid="aviso" onClick={() => setWarning(null)}>
          {warning}
        </div>
      )}
      <span hidden data-meta={meta.lastTrack} />
    </>
  );
}
