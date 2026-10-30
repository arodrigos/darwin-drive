import { ALTO, ANCHO, type EntradaClip } from "./nucleo";
import type { DesdeClip, HaciaClip, MotivoClip } from "./protocolo";

export interface ResultadoClip {
  mime: "video/mp4";
  bytes: number;
  cabeceraFtyp: boolean;
  duracionS: number;
  ancho: number;
  alto: number;
  fotogramas: number;
  factor: number;
  distanciaFinal: number;
  codec: string;
  /** PNG del fotograma central como dataURL. */
  fotogramaMuestra: string;
  blob: Blob;
}

export class ErrorClip extends Error {
  constructor(
    readonly motivo: MotivoClip | "cancelado",
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Sin VideoEncoder u OffscreenCanvas el botón no aparece: no hay caída a MediaRecorder (decisión de diseño). */
export async function soporteClip(): Promise<boolean> {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof VideoEncoder === "undefined") return false;
  const configs = [
    { codec: "avc1.42001f", width: ANCHO, height: ALTO },
    { codec: "vp09.00.10.08", width: ANCHO, height: ALTO },
  ];
  for (const c of configs) {
    try {
      if ((await VideoEncoder.isConfigSupported(c)).supported) return true;
    } catch {
      /* un códec que lanza no está disponible */
    }
  }
  return false;
}

const aDataUrl = (png: ArrayBuffer) =>
  new Promise<string>((ok, ko) => {
    const lector = new FileReader();
    lector.onload = () => ok(lector.result as string);
    lector.onerror = () => ko(lector.error);
    lector.readAsDataURL(new Blob([png], { type: "image/png" }));
  });

/** Genera el clip en un Worker propio. Cancelar (señal) lo termina sin dejar nada. */
export function generarClip(entrada: EntradaClip, opciones: { onProgreso?: (fraccion: number) => void; signal?: AbortSignal } = {}): Promise<ResultadoClip> {
  return new Promise((resolver, rechazar) => {
    if (opciones.signal?.aborted) return rechazar(new ErrorClip("cancelado", "cancelado"));
    let worker: Worker;
    try {
      worker = new Worker(new URL("./clip.worker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      return rechazar(new ErrorClip("fallo", e instanceof Error ? e.message : "no se pudo crear el Worker"));
    }
    const cerrar = () => {
      opciones.signal?.removeEventListener("abort", alCancelar);
      worker.terminate();
    };
    const alCancelar = () => {
      cerrar();
      rechazar(new ErrorClip("cancelado", "cancelado"));
    };
    opciones.signal?.addEventListener("abort", alCancelar);
    worker.onerror = () => {
      cerrar();
      rechazar(new ErrorClip("fallo", "El Worker del clip falló"));
    };
    worker.onmessage = (e: MessageEvent<DesdeClip>) => {
      const m = e.data;
      if (m.tipo === "progreso") return opciones.onProgreso?.(m.fraccion);
      cerrar();
      if (m.tipo === "error") return rechazar(new ErrorClip(m.motivo, m.detalle));
      const cabecera = new Uint8Array(m.mp4, 4, 4);
      const blob = new Blob([m.mp4], { type: "video/mp4" });
      aDataUrl(m.muestra).then(
        (fotogramaMuestra) =>
          resolver({
            mime: "video/mp4",
            bytes: blob.size,
            cabeceraFtyp: String.fromCharCode(...cabecera) === "ftyp",
            duracionS: m.duracionS,
            ancho: ANCHO,
            alto: ALTO,
            fotogramas: m.fotogramas,
            factor: m.factor,
            distanciaFinal: m.distanciaFinal,
            codec: m.codec,
            fotogramaMuestra,
            blob,
          }),
        (err) => rechazar(new ErrorClip("fallo", String(err))),
      );
    };
    worker.postMessage({ tipo: "generar", entrada } satisfies HaciaClip);
  });
}
