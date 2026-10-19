"use client";

import { useCallback, useEffect, useState } from "react";
import { instalarGanchos, registrarManejadores, runtime, type Escenario } from "@/debug/ganchos";
import { markInput } from "@/debug/latencias";
import { DEFAULT_TRACK_ID, getTrack, type TrackId } from "@/sim/tracks";
import { DEFAULT_META, loadMeta, saveMeta, type Meta } from "@/storage/meta";
import { emptyRankings, KEY_RANKINGS, validateRankings, type Rankings } from "@/storage/schema";
import { loadAll, save } from "@/storage/store";
import { Explorar } from "./components/Explorar";
import { Pista } from "./components/Pista";
import { Portada } from "./components/Portada";

type Pantalla = "portada" | "explorar" | "pista";

function publicar(r: Rankings): void {
  for (const id of Object.keys(r) as TrackId[]) {
    runtime.rankings[id] = r[id].map((e) => ({ carId: e.carId, distance: e.distance, origin: e.origin }));
  }
}

export function App() {
  const [screen, setScreen] = useState<Pantalla>("portada");
  const [trackId, setTrackId] = useState<TrackId>(DEFAULT_TRACK_ID);
  const [meta, setMeta] = useState<Meta>(DEFAULT_META);
  const [rankings, setRankings] = useState<Rankings>(emptyRankings());
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

  const aplicarRankings = useCallback((r: Rankings) => {
    publicar(r);
    setRankings(r);
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
    loadAll().then(({ data }) => aplicarRankings((data[KEY_RANKINGS] as Rankings | undefined) ?? emptyRankings()));
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
          aplicarRankings(emptyRankings());
        }
        if (typeof e.rankings === "object" && e.rankings !== null) {
          const validos = validateRankings({ ...emptyRankings(), ...e.rankings });
          if (!validos) throw new Error("escenario con rankings inválidos");
          await save(KEY_RANKINGS, validos);
          aplicarRankings(validos);
        }
        setScreen("portada");
      },
    });
  }, [aplicarRankings]);

  useEffect(() => {
    runtime.pantalla = screen === "explorar" ? "pista" : screen;
  }, [screen]);

  return (
    <>
      {screen === "portada" && (
        <Portada
          rankings={rankings}
          onExplore={() => setScreen("explorar")}
          onStock={() => {
            markInput("abrir-pista");
            setScreen("pista");
          }}
          onPickTrack={chooseTrack}
        />
      )}
      {screen === "explorar" && (
        <Explorar trackId={trackId} onTrack={chooseTrack} onBack={() => setScreen("portada")} rankings={rankings} />
      )}
      {screen === "pista" && <Pista trackId={trackId} onBack={() => setScreen("portada")} rankings={rankings} />}
      {warning && (
        <div className="aviso" role="status" data-testid="aviso" onClick={() => setWarning(null)}>
          {warning}
        </div>
      )}
      <span hidden data-meta={meta.lastTrack} />
    </>
  );
}
