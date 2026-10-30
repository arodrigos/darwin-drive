import { PALETTES, cssColor } from "../game/palette";
import { NOMBRE_MEDALLA, type Medalla } from "../app/medallas";
import { resolverPista, type TrackId } from "../sim/tracks";
import type { Genome } from "../sim/genome";
import { ALTO, ANCHO, type Fotograma } from "./nucleo";

const PX_POR_M = 20;
const COCHE_X = 0.3;
const COLOR_MEDALLA: Record<Medalla, string> = { bronce: "#cd7f32", plata: "#d8dde3", oro: "#ffd24d", autor: "#4de0a5" };

type Ctx = OffscreenCanvasRenderingContext2D;

/**
 * Pintor 2D del clip: solo la pista, el coche y los rótulos. Guarda la altura suavizada de la cámara entre
 * fotogramas, así que hay que llamarlo en orden con un pintor nuevo por clip.
 */
export function crearPintor(ctx: Ctx, entrada: { genome: Genome; trackId: TrackId; nombre: string; color: string }) {
  const track = resolverPista(entrada.trackId);
  if (!track) throw new Error(`Pista desconocida: ${String(entrada.trackId)}`);
  const pal = PALETTES[entrada.trackId];
  const puntos = Array.from(entrada.genome.body, (v) => ({ x: Math.cos(v.angle) * v.length, y: Math.sin(v.angle) * v.length }));
  let camY: number | null = null;
  const rotulo = `${entrada.nombre} · ${track.name}`;

  return function pintar(f: Fotograma): void {
    const { pose } = f;
    camY = camY === null ? pose.y : camY + (pose.y - camY) * 0.15;
    const camX = pose.x - COCHE_X * (ANCHO / PX_POR_M);
    const sx = (wx: number) => (wx - camX) * PX_POR_M;
    const sy = (wy: number) => ALTO * 0.6 - (wy - camY!) * PX_POR_M;

    const cielo = ctx.createLinearGradient(0, 0, 0, ALTO);
    cielo.addColorStop(0, cssColor(pal.skyTop));
    cielo.addColorStop(1, cssColor(pal.skyBottom));
    ctx.fillStyle = cielo;
    ctx.fillRect(0, 0, ANCHO, ALTO);

    ctx.beginPath();
    ctx.moveTo(0, ALTO);
    for (let px = 0; px <= ANCHO; px += 4) ctx.lineTo(px, sy(track.heightAt(camX + px / PX_POR_M)));
    ctx.lineTo(ANCHO, ALTO);
    ctx.closePath();
    ctx.fillStyle = cssColor(pal.earth);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = cssColor(pal.grass);
    ctx.stroke();

    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    const aPantalla = (p: { x: number; y: number }) => ({ x: sx(pose.x + c * p.x - s * p.y), y: sy(pose.y + s * p.x + c * p.y) });
    const mascara = pose.piezas ?? 255;
    const centro = aPantalla({ x: 0, y: 0 });
    ctx.fillStyle = entrada.color;
    ctx.strokeStyle = "#1b1b1b";
    ctx.lineWidth = 1.5;
    puntos.forEach((a, i) => {
      if (!(mascara & (1 << i))) return;
      const pa = aPantalla(a);
      const pb = aPantalla(puntos[(i + 1) % puntos.length]);
      ctx.beginPath();
      ctx.moveTo(centro.x, centro.y);
      ctx.lineTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    for (const w of pose.wheels) {
      if (w.suelta || w.fuera) continue;
      const cx = sx(w.x);
      const cy = sy(w.y);
      const r = w.radius * PX_POR_M;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#2b2b2b";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      // La rueda gira en sentido horario en pantalla: y crece hacia abajo.
      ctx.lineTo(cx + Math.cos(-w.angle) * r, cy + Math.sin(-w.angle) * r);
      ctx.strokeStyle = "#f2efe6";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Franja de rótulos: sombra para que se lea sobre cualquier cielo.
    ctx.fillStyle = "rgba(10,14,22,0.55)";
    ctx.fillRect(0, 0, ANCHO, 44);
    ctx.textBaseline = "middle";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText(rotulo, 12, 22, ANCHO - 200);
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(f.distancia)} m`, ANCHO - 12, 22);
    const y = 64;
    if (f.medalla) {
      ctx.fillStyle = COLOR_MEDALLA[f.medalla];
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`● ${NOMBRE_MEDALLA[f.medalla]}`, 12, y);
    }
    if (f.factor > 1) {
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(10,14,22,0.7)";
      ctx.fillRect(ANCHO - 70, y - 14, 62, 28);
      ctx.fillStyle = "#fff";
      ctx.fillText(`×${f.factor}`, ANCHO - 16, y);
    }
  };
}
