"use client";

import { useEffect, useRef, useState } from "react";
import { compartirFichero, descargarFichero, puedeCompartirFichero } from "@/app/compartir";
import { entradaDeMarca } from "@/clip/entrada";
import { ErrorClip, generarClip, soporteClip } from "@/clip/generar";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import type { RankingEntry } from "@/storage/schema";

type Estado =
  | { fase: "reposo" }
  | { fase: "generando"; porcentaje: number }
  | { fase: "listo"; file: File }
  | { fase: "error"; motivo: string };

export const textoErrorClip = (motivo: string) => `No se pudo generar el clip: ${motivo}. Prueba otra vez o usa «Ver repetición».`;

/** Motivo legible; el detalle técnico del Worker no es para quien juega. */
const MOTIVOS: Record<string, string> = {
  "no-coincide": "la carrera no sale igual que la marca guardada",
  "sin-soporte": "tu navegador no puede codificar vídeo",
  fallo: "falló la codificación",
};

/** «Guardar clip» junto a «Ver repetición»: no aparece si el navegador no puede generar vídeo. */
export function BotonClip({ entry, disponible }: { entry: RankingEntry; disponible: boolean }) {
  const [soporte, setSoporte] = useState(false);
  const [estado, setEstado] = useState<Estado>({ fase: "reposo" });
  const control = useRef<AbortController | null>(null);

  useEffect(() => {
    let vivo = true;
    void soporteClip().then((s) => vivo && setSoporte(s));
    return () => {
      vivo = false;
    };
  }, []);

  // Rankings lo monta con key por fila: al cambiar de fila o salir de la pantalla el Worker del clip se termina, no se queda trabajando para nadie.
  useEffect(() => () => control.current?.abort(), []);

  // La barra o el estado final ya están pintados cuando corre este efecto.
  useEffect(() => {
    if (estado.fase === "generando" && estado.porcentaje === 0) measureOnNextFrame("guardar-clip");
  }, [estado]);

  if (!soporte || !disponible) return null;

  const generar = () => {
    markInput("guardar-clip");
    const ctl = new AbortController();
    control.current = ctl;
    setEstado({ fase: "generando", porcentaje: 0 });
    generarClip(entradaDeMarca(entry), { signal: ctl.signal, onProgreso: (f) => setEstado({ fase: "generando", porcentaje: Math.round(f * 100) }) }).then(
      (r) => {
        const nombre = `darwin-${entry.trackId}-${Math.floor(entry.distance)}m.mp4`;
        setEstado({ fase: "listo", file: new File([r.blob], nombre, { type: r.mime }) });
      },
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        setEstado({ fase: "error", motivo: e instanceof ErrorClip ? (MOTIVOS[e.motivo] ?? "falló la codificación") : "falló la codificación" });
      },
    );
  };

  const cancelar = () => {
    control.current?.abort();
    setEstado({ fase: "reposo" });
  };

  // En su propio toque: iOS exige gesto de usuario para share({files}) y no admite esperas previas.
  const compartir = (file: File) => {
    markInput("guardar-clip");
    void compartirFichero(file);
  };

  return (
    <>
      {(estado.fase === "reposo" || estado.fase === "error") && (
        <button type="button" className="pastilla" onClick={generar} data-testid="guardar-clip">
          Guardar clip
        </button>
      )}
      {estado.fase === "generando" && (
        <div className="progreso-clip" role="status" data-testid="clip-progreso">
          <span>Generando clip… {estado.porcentaje} %</span>
          <progress max={100} value={estado.porcentaje} aria-label="Progreso del clip" />
          <button type="button" className="pastilla" onClick={cancelar} data-testid="cancelar-clip">
            Cancelar
          </button>
        </div>
      )}
      {estado.fase === "listo" && (
        <>
          {puedeCompartirFichero(estado.file) && (
            <button type="button" className="pastilla" onClick={() => compartir(estado.file)} data-testid="compartir-clip">
              Compartir clip
            </button>
          )}
          <button type="button" className="pastilla" onClick={() => descargarFichero(estado.file)} data-testid="descargar-clip">
            Descargar
          </button>
        </>
      )}
      {estado.fase === "error" && (
        <p className="nota-migracion" role="alert" data-testid="clip-error">
          {textoErrorClip(estado.motivo)}
        </p>
      )}
    </>
  );
}
