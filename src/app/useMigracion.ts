import { useCallback, useEffect, useRef, useState } from "react";
import { runtime } from "@/debug/ganchos";
import { migrar, type EstadoMigracion, type Medir } from "@/storage/migracion";
import { pestanasAntiguas } from "@/pwa/pestanas";
import { createSimRunner } from "@/worker";
import type { CarResult } from "@/sim/constants";
import type { SimRunner } from "@/worker/protocol";

/** Una carrera en turbo con un solo coche; se aborta con `stop` y no deja el worker ocupado. */
export function medirConRunner(runner: SimRunner): Medir {
  let n = 0;
  return (genome, trackId, senal) =>
    new Promise<CarResult>((resolver, rechazar) => {
      const raceId = `migrar-${n++}`;
      let fin = false;
      const cerrar = () => {
        fin = true;
        quitar();
        senal.removeEventListener("abort", abortar);
      };
      const abortar = () => {
        if (fin) return;
        cerrar();
        runner.post({ type: "stop", raceId });
        rechazar(new Error("medida descartada"));
      };
      const quitar = runner.subscribe((m) => {
        if (m.raceId !== raceId || fin) return;
        if (m.type === "raceDone") {
          cerrar();
          resolver(m.results[0]);
        } else if (m.type === "error") {
          cerrar();
          rechazar(new Error(m.message));
        }
      });
      senal.addEventListener("abort", abortar);
      // Gancho de pruebas: la medida no arranca hasta que se suelte, para poder ver la banda a medias.
      const arrancar = () => {
        if (fin) return;
        if (runtime.migracionFrenada) setTimeout(arrancar, 50);
        else runner.post({ type: "startRace", raceId, cars: [{ carId: "migracion", genome }], trackId, pace: "turbo" });
      };
      arrancar();
    });
}

const INICIAL: EstadoMigracion = { enCurso: false, hechos: 0, total: 0, enVuelo: null, intentos: {}, conservados: [] };

/**
 * Lanza la migración de marcas y la repite desde cero si se pide otra mientras corre (importar una copia).
 * Los intentos se guardan entre pasadas: lo ya conservado no vuelve a medirse hasta recargar la página.
 */
export function useMigracion(alAvanzar: () => Promise<void>) {
  const [estado, setEstado] = useState<EstadoMigracion>(INICIAL);
  /** Medidas de la última pasada completa; null hasta que el aviso final se cierra. */
  /** Hay pestañas abiertas con una versión sin saludo: la migración espera a que se recarguen. */
  const [esperando, setEsperando] = useState(false);
  const [terminadas, setTerminadas] = useState<number | null>(null);
  const corriendo = useRef<AbortController | null>(null);
  const intentos = useRef<Record<string, number>>({});
  const avanzar = useRef(alAvanzar);
  useEffect(() => {
    avanzar.current = alAvanzar;
  }, [alAvanzar]);

  const iniciar = useCallback(async () => {
    corriendo.current?.abort();
    const control = new AbortController();
    corriendo.current = control;
    const runner = createSimRunner();
    let ultimo = -1;
    try {
      const resumen = await migrar({
        medir: medirConRunner(runner),
        senal: control.signal,
        intentos: intentos.current,
        pestanasAntiguas: () => (runtime.pestanasAntiguasFingidas ? Promise.resolve(1) : pestanasAntiguas()),
        alProgreso: (e) => {
          if (control.signal.aborted) return;
          runtime.migracion = e;
          setEstado(e);
          if (e.hechos !== ultimo) {
            ultimo = e.hechos;
            void avanzar.current();
          }
        },
      });
      if (!control.signal.aborted) setEsperando(resumen.estado === "esperando-pestanas");
      if (!control.signal.aborted && resumen.estado === "completa" && resumen.medidos > 0) setTerminadas(resumen.medidos);
    } finally {
      runner.terminate();
      if (corriendo.current === control) {
        corriendo.current = null;
        setEstado((e) => ({ ...e, enCurso: false, enVuelo: null }));
        void avanzar.current();
      }
    }
  }, []);

  useEffect(() => () => corriendo.current?.abort(), []);
  return { estado, iniciar, esperando, terminadas, cerrarAviso: () => setTerminadas(null) };
}
