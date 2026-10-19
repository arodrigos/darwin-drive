import Phaser from "phaser";
import { createNoise2D } from "simplex-noise";
import { measureOnNextFrame, markInput } from "@/debug/latencias";
import { SEGMENT_LENGTH, segmentVertices } from "@/sim/terrain";
import type { Track } from "@/sim/tracks";
import { cssColor, PALETTES } from "./palette";

export const PX_PER_METER = 20;
// Los tramos se crean por delante de la cámara y se sueltan por detrás, como hará la carrera.
const AHEAD_M = 60;
const BEHIND_M = 25;
const RULER_HEIGHT = 24;
const MAX_LABELS = 14;

export interface ExploreFrame {
  camX: number;
  generated: number;
}

export interface ExploreHandle {
  setTrack(track: Track): void;
  cameraX(): number;
  destroy(): void;
}

// Capa decorativa sin colisión: mismo ruido para todas, con el tono de cada pista.
const farNoise = createNoise2D(() => 0.31);

type Point = { x: number; y: number };
type Vec = Phaser.Math.Vector2;
const vec = (x: number, y: number): Vec => new Phaser.Math.Vector2(x, y);

class ExploreScene extends Phaser.Scene {
  private track: Track;
  private camX = 0;
  private segments = new Map<number, Point[]>();
  private generated = 0;
  private dirty = true;
  private sky!: Phaser.GameObjects.Graphics;
  private hills!: Phaser.GameObjects.Graphics;
  private ground!: Phaser.GameObjects.Graphics;
  private ruler!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private lastPointerX = 0;
  private dragging = false;
  private firstFrame = true;
  private readonly onFrame: (f: ExploreFrame) => void;

  constructor(track: Track, onFrame: (f: ExploreFrame) => void) {
    super("explore");
    this.track = track;
    this.onFrame = onFrame;
  }

  setTrack(track: Track): void {
    this.track = track;
    this.camX = 0;
    this.segments.clear();
    this.generated = 0;
    this.dirty = true;
  }

  cameraX(): number {
    return this.camX;
  }

  create(): void {
    this.sky = this.add.graphics();
    this.hills = this.add.graphics();
    this.ground = this.add.graphics();
    this.ruler = this.add.graphics();
    for (let i = 0; i < MAX_LABELS; i++) {
      this.labels.push(
        this.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#ffffff" }).setVisible(false),
      );
    }
    this.scale.on("resize", () => (this.dirty = true));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.lastPointerX = p.x;
      markInput("arrastrar-pista");
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      const dx = p.x - this.lastPointerX;
      this.lastPointerX = p.x;
      if (dx === 0) return;
      // Arrastrar hacia la izquierda mueve el mundo a la izquierda: la cámara avanza.
      this.camX = Math.max(0, this.camX - dx / PX_PER_METER);
      this.dirty = true;
    });
    const stop = () => (this.dragging = false);
    this.input.on("pointerup", stop);
    this.input.on("pointerupoutside", stop);
    // Con el contexto WebGL perdido el lienzo se queda en blanco: al volver, se repinta desde el estado.
    this.game.canvas.addEventListener("webglcontextrestored", () => (this.dirty = true));
    markInput("abrir-pista");
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
    this.onFrame({ camX: this.camX, generated: this.generated });
    if (this.firstFrame) {
      this.firstFrame = false;
      measureOnNextFrame("abrir-pista");
    }
    measureOnNextFrame("arrastrar-pista");
  }

  private ensureSegments(widthM: number): void {
    const first = Math.floor(Math.max(0, this.camX - BEHIND_M) / SEGMENT_LENGTH);
    const last = Math.floor((this.camX + widthM + AHEAD_M) / SEGMENT_LENGTH);
    for (const idx of [...this.segments.keys()]) if (idx < first || idx > last) this.segments.delete(idx);
    for (let i = first; i <= last; i++) {
      if (!this.segments.has(i)) {
        this.segments.set(i, segmentVertices(this.track, i));
        this.generated++;
      }
    }
  }

  private draw(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const pal = PALETTES[this.track.id];
    const widthM = W / PX_PER_METER;
    this.ensureSegments(widthM);

    // Altura de referencia: el terreno visible más bajo nunca baja del 85 % de la pantalla,
    // así las filas inferiores son siempre tierra y nunca cielo.
    let hMin = Infinity;
    for (let x = this.camX; x <= this.camX + widthM; x += 0.5) hMin = Math.min(hMin, this.track.heightAt(x));
    const hCentre = this.track.heightAt(this.camX + widthM / 2);
    const yCentre = Math.min(0.55 * H, 0.85 * H + (hMin - hCentre) * PX_PER_METER);
    const toY = (h: number) => yCentre - (h - hCentre) * PX_PER_METER;
    const toX = (x: number) => (x - this.camX) * PX_PER_METER;

    this.sky.clear();
    const bands = 24;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(pal.skyTop),
        Phaser.Display.Color.IntegerToColor(pal.skyBottom),
        100,
        Math.round(t * 100),
      );
      this.sky.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      this.sky.fillRect(0, (H * i) / bands, W, H / bands + 1);
    }

    this.hills.clear();
    const layers = [
      { factor: 0.15, colour: pal.far, base: 0.5, amp: 0.3, freq: 1 / 28 },
      { factor: 0.35, colour: pal.near, base: 0.62, amp: 0.22, freq: 1 / 16 },
    ];
    layers.forEach((l, li) => {
      const pts: Vec[] = [vec(0, H)];
      for (let sx = 0; sx <= W + 8; sx += 8) {
        const wx = this.camX * l.factor + sx / PX_PER_METER;
        pts.push(vec(sx, H * l.base - ((farNoise(wx * l.freq, li * 5) + 1) / 2) * H * l.amp));
      }
      pts.push(vec(W + 8, H));
      this.hills.fillStyle(l.colour, 1).fillPoints(pts, true);
    });

    this.ground.clear();
    const idxs = [...this.segments.keys()].sort((a, b) => a - b);
    const line: Vec[] = [];
    for (const i of idxs) {
      const verts = this.segments.get(i)!;
      for (let k = i === idxs[0] ? 0 : 1; k < verts.length; k++) line.push(vec(toX(verts[k].x), toY(verts[k].y)));
    }
    const body: Vec[] = [vec(line[0].x, H + 4), ...line, vec(line[line.length - 1].x, H + 4)];
    this.ground.fillStyle(pal.earth, 1).fillPoints(body, true);
    this.ground.lineStyle(5, pal.grass, 1).strokePoints(line, false, false);
    // Línea de salida en 0 m.
    const startX = toX(0);
    if (startX > -10 && startX < W + 10) {
      const y0 = toY(0);
      this.ground.lineStyle(3, 0xffffff, 1).lineBetween(startX, y0, startX, y0 - 70);
      this.ground.fillStyle(0xd62828, 1).fillRect(startX, y0 - 70, 26, 16);
    }

    this.drawRuler(W, H, toX);
  }

  private drawRuler(W: number, H: number, toX: (x: number) => number): void {
    this.ruler.clear();
    this.ruler.fillStyle(0x000000, 0.45).fillRect(0, H - RULER_HEIGHT, W, RULER_HEIGHT);
    let used = 0;
    const firstTick = Math.ceil(this.camX / 10) * 10;
    for (let m = firstTick; toX(m) < W && used < MAX_LABELS; m += 10) {
      const x = toX(m);
      this.ruler.lineStyle(2, 0xffffff, 0.9).lineBetween(x, H - RULER_HEIGHT, x, H - RULER_HEIGHT + 8);
      this.labels[used].setText(`${m} m`).setPosition(x + 3, H - RULER_HEIGHT + 6).setVisible(true);
      used++;
    }
    for (let i = used; i < MAX_LABELS; i++) this.labels[i].setVisible(false);
  }
}

export function startExplore(parent: HTMLElement, track: Track, onFrame: (f: ExploreFrame) => void): ExploreHandle {
  const scene = new ExploreScene(track, onFrame);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: cssColor(PALETTES[track.id].skyTop),
    // preserveDrawingBuffer deja leer el lienzo en las pruebas de pantalla.
    render: { preserveDrawingBuffer: true },
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 360, height: parent.clientHeight || 640 },
    scene,
  });
  return {
    setTrack: (t) => scene.setTrack(t),
    cameraX: () => scene.cameraX(),
    destroy: () => game.destroy(true),
  };
}
