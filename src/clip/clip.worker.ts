import { ALTO, ANCHO, FPS, MOTIVO_NO_COINCIDE, fotogramas, verificar } from "./nucleo";
import { crearPintor } from "./pintor";
import type { DesdeClip, HaciaClip } from "./protocolo";

const BITRATE = 2_500_000;
// Un tope de 8 MB: a 2,5 Mbps y 20 s salen ~6 MB, pero un mapa muy ruidoso puede pasarse.
const MAX_BYTES = 8 * 1024 * 1024;

const enviar = (m: DesdeClip, transfer: Transferable[] = []) => postMessage(m, { transfer });

async function generar({ entrada }: Extract<HaciaClip, { tipo: "generar" }>): Promise<void> {
  const { resultado, plan } = verificar(entrada);
  // mediabunny solo se carga aquí: nunca entra en el bundle inicial.
  const mb = await import("mediabunny");
  const codec = await mb.getFirstEncodableVideoCodec(["avc", "vp9"], { width: ANCHO, height: ALTO });
  if (!codec) {
    enviar({ tipo: "error", motivo: "sin-soporte", detalle: "Este navegador no puede codificar vídeo MP4" });
    return;
  }
  const canvas = new OffscreenCanvas(ANCHO, ALTO);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto 2D");
  const pintar = crearPintor(ctx, entrada);
  const salida = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
  const fuente = new mb.CanvasSource(canvas, { codec, bitrate: BITRATE });
  salida.addVideoTrack(fuente, { frameRate: FPS });
  await salida.start();

  let muestra: ArrayBuffer | null = null;
  const central = Math.floor(plan.fotogramas / 2);
  for (const f of fotogramas(entrada, plan, resultado)) {
    pintar(f);
    await fuente.add(f.ts, 1 / FPS);
    if (f.indice === central) muestra = await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
    if (f.indice % 10 === 0) enviar({ tipo: "progreso", fraccion: (f.indice + 1) / plan.fotogramas });
  }
  fuente.close();
  await salida.finalize();
  const mp4 = (salida.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!mp4 || !muestra) throw new Error("el codificador no produjo vídeo");
  if (mp4.byteLength > MAX_BYTES) throw new Error("el clip supera los 8 MB");
  enviar(
    { tipo: "listo", mp4, codec, fotogramas: plan.fotogramas, duracionS: plan.duracionS, factor: plan.factor, distanciaFinal: resultado.distance, muestra },
    [mp4, muestra],
  );
}

self.onmessage = (e: MessageEvent<HaciaClip>) => {
  generar(e.data).catch((err: unknown) => {
    const detalle = err instanceof Error ? err.message : String(err);
    enviar({ tipo: "error", motivo: detalle === MOTIVO_NO_COINCIDE ? "no-coincide" : "fallo", detalle });
  });
};
