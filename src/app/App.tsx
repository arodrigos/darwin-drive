"use client";

import { useCallback, useEffect, useState } from "react";
import { instalarGanchos, registrarManejadores, runtime, type Escenario } from "@/debug/ganchos";
import { DEFAULT_TRACK_ID, getTrack, type TrackId } from "@/sim/tracks";
import { DEFAULT_META, loadMeta, saveMeta, type Meta } from "@/storage/meta";
import { Explorar } from "./components/Explorar";
import { Portada } from "./components/Portada";
import type { RankingsView } from "./components/TrackPicker";

// Hasta que exista el guardado de rankings, ninguna pista tiene marcas.
const NO_RANKINGS: RankingsView = { cordillera: [], rampa: [], dunas: [], pedregal: [] };

export function App() {
  const [screen, setScreen] = useState<"portada" | "pista">("portada");
  const [trackId, setTrackId] = useState<TrackId>(DEFAULT_TRACK_ID);
  const [meta, setMeta] = useState<Meta>(DEFAULT_META);
  const [warning, setWarning] = useState<string | null>(null);

  const chooseTrack = useCallback((id: TrackId) => {
    setTrackId(id);
    runtime.pistaSeleccionada = id;
    setMeta((m) => {
      const next = { ...m, lastTrack: id };
      void saveMeta(next);
      return next;
    });
  }, []);

  useEffect(() => {
    instalarGanchos();
    loadMeta().then(({ meta: loaded, warning: w, available }) => {
      setMeta(loaded);
      setTrackId(loaded.lastTrack);
      runtime.pistaSeleccionada = loaded.lastTrack;
      runtime.disponible = available;
      setWarning(w);
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
        setScreen("portada");
      },
    });
  }, []);

  useEffect(() => {
    runtime.pantalla = screen;
  }, [screen]);

  return (
    <>
      {screen === "portada" ? (
        <Portada rankings={NO_RANKINGS} onExplore={() => setScreen("pista")} onPickTrack={chooseTrack} />
      ) : (
        <Explorar trackId={trackId} onTrack={chooseTrack} onBack={() => setScreen("portada")} rankings={NO_RANKINGS} />
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
