"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { instalarGanchos, registrarManejadores, runtime, type Escenario } from "@/debug/ganchos";
import { markInput } from "@/debug/latencias";
import type { CarResult } from "@/sim/constants";
import { genomeHash, normalizeGenome, STOCK_CAR, type Genome } from "@/sim/genome";
import { DEFAULT_TRACK_ID, getTrack, type TrackId } from "@/sim/tracks";
import { DEFAULT_META, loadMeta, saveMeta, type Meta } from "@/storage/meta";
import {
  emptyRankings,
  KEY_GARAGE,
  KEY_RANKINGS,
  validateGarage,
  validateRankings,
  type Rankings,
  type SavedCar,
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
import { Explorar } from "./components/Explorar";
import { Garaje } from "./components/Garaje";
import { Pista } from "./components/Pista";
import { Portada } from "./components/Portada";
import { Taller } from "./components/Taller";

type Pantalla = "portada" | "explorar" | "pista" | "taller" | "garaje";

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
  // De dónde se abrió la pista: «Volver» regresa allí.
  const [origenPista, setOrigenPista] = useState<Pantalla>("portada");
  const [trackId, setTrackId] = useState<TrackId>(DEFAULT_TRACK_ID);
  const [meta, setMeta] = useState<Meta>(DEFAULT_META);
  const [rankings, setRankings] = useState<Rankings>(emptyRankings());
  const [garage, setGarage] = useState<SavedCar[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [workshopGenome, setWorkshopGenome] = useState<Genome>(STOCK_CAR);
  // El genoma que se manda a la pista; null = el coche de serie de «Ver el coche de serie».
  const [trial, setTrial] = useState<{ genome: Genome; origin: SavedCar["origin"] } | null>(null);
  const metaRef = useRef(meta);
  const genomeRef = useRef(workshopGenome);
  useEffect(() => {
    metaRef.current = meta;
    genomeRef.current = workshopGenome;
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
    aplicarRankings((data[KEY_RANKINGS] as Rankings | undefined) ?? emptyRankings());
    aplicarGaraje((data[KEY_GARAGE] as SavedCar[] | undefined) ?? []);
  }, [aplicarRankings, aplicarGaraje]);

  const editar = useCallback((g: Genome) => {
    const n = normalizeGenome(g);
    runtime.genomaEnTaller = n;
    setWorkshopGenome(n);
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
    loadAll().then(({ data }) => {
      aplicarRankings((data[KEY_RANKINGS] as Rankings | undefined) ?? emptyRankings());
      aplicarGaraje((data[KEY_GARAGE] as SavedCar[] | undefined) ?? []);
    });
    registrarManejadores({
      async cargarEscenario(e: Escenario) {
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
          editar(STOCK_CAR);
        }
        if (typeof e.rankings === "object" && e.rankings !== null) {
          const validos = validateRankings({ ...emptyRankings(), ...e.rankings });
          if (!validos) throw new Error("escenario con rankings inválidos");
          await save(KEY_RANKINGS, validos);
          aplicarRankings(validos);
        }
        if (Array.isArray(e.garaje)) {
          const coches = e.garaje.map((item, i) =>
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
        if (e.genoma !== undefined) editar(normalizeGenome(e.genoma));
        setScreen("portada");
      },
    });
  }, [aplicarRankings, aplicarGaraje, editar]);

  useEffect(() => {
    runtime.pantalla = screen === "explorar" ? "pista" : screen;
  }, [screen]);

  const abrirTaller = useCallback(() => {
    markInput("abrir-pista");
    runtime.genomaEnTaller = genomeRef.current;
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
      await recordMark(result.carId, result.trackId, result.distance);
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

  const guardarCoche = useCallback(async (): Promise<string> => {
    const genome = genomeRef.current;
    const id = genomeHash(genome);
    const existente = garage.find((c) => c.id === id);
    const marks: SavedCar["marks"] = { ...(existente?.marks ?? {}) };
    for (const t of Object.keys(rankings) as TrackId[]) {
      const entrada = rankings[t].find((r) => r.genomeHash === id);
      if (entrada) marks[t] = Math.max(marks[t] ?? 0, entrada.distance);
    }
    const car: SavedCar = {
      id,
      name: existente?.name ?? `Diseño ${garage.length + 1}`,
      genome,
      marks,
      origin: existente?.origin ?? "diseño",
      savedAt: new Date().toISOString(),
    };
    const r = await saveToGarage(car);
    if (!r.ok) return GARAGE_FULL_MESSAGE;
    await recargar();
    return runtime.disponible ? GUARDADO_OK : "Guardado, pero solo hasta que cierres la pestaña.";
  }, [garage, rankings, recargar]);

  const volverDePista = useCallback(() => setScreen(origenPista), [origenPista]);

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
          onPickTrack={chooseTrack}
          onTaller={abrirTaller}
          onGarage={() => setScreen("garaje")}
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
          onOpen={(car) => {
            editar(car.genome);
            setScreen("taller");
          }}
          onDelete={async (car) => {
            await removeFromGarage(car.id);
            await recargar();
          }}
          onTaller={abrirTaller}
          onBack={() => setScreen("portada")}
        />
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
