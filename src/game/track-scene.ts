import Phaser from "phaser";
import { createNoise2D } from "simplex-noise";
import { measureOnNextFrame } from "@/debug/latencias";
import { formatMeters } from "@/app/format";
import type { CarPose, CarResult } from "@/sim/constants";
import type { Genome } from "@/sim/genome";
import { SEGMENT_LENGTH, segmentVertices } from "@/sim/terrain";
import type { Track } from "@/sim/tracks";
import { cssColor, PALETTES } from "./palette";

const PX_PER_METER = 20;
const AHEAD_M = 60;
const BEHIND_M = 25;
const RULER_HEIGHT = 24;
const MAX_LABELS = 14;
const FINISH_LABEL_MS = 1500;
const LEADER_SCREEN_X = 0.3;
const FOLLOW_Y = 0.1;
const FINISHED_GREY = 0x8a8f94;
// Radio de acierto de un toque: un dedo no apunta a un coche de 2 m a 20 px/m.
const PICK_RADIUS_PX = 48;

const farNoise = createNoise2D(() => 0.31);

export interface SceneCar {
  carId: string;
  genome: Genome;
  /** 0..360, el color con el que se pinta el coche mientras corre. */
  hue: number;
  label?: string;
}

export interface SceneConfig {
  track: Track;
  cars: SceneCar[];
  /** Marca del n.º 1 de la pista: se clava una bandera en su x. */
  flag: number | null;
}

export interface TrackSceneHandle {
  begin(cfg: SceneConfig): void;
  setPoses(simTime: number, poses: CarPose[], snap: boolean): void;
  /** Clava la bandera del n.º 1 en esa x (nuevo récord). */
  setFlag(x: number | null): void;
  carFinished(result: CarResult): void;
  /** Los coches con estrella ★ encima (los favoritos de la generación en curso). */
  setFavorites(ids: string[]): void;
  /** Avisa del coche vivo que ha tocado el jugador (el más cercano al dedo, con margen para un dedo). */
  onPick(listener: ((carId: string) => void) | null): void;
  destroy(): void;
}

type Vec = Phaser.Math.Vector2;
const vec = (x: number, y: number): Vec => new Phaser.Math.Vector2(x, y);

function hueColour(hue: number, light: number): number {
  return Phaser.Display.Color.HSLToColor(hue / 360, 0.7, light).color;
}

function mixPose(a: CarPose, b: CarPose, t: number): CarPose {
  if (b.finished) return b;
  const l = (p: number, q: number) => p + (q - p) * t;
  return {
    ...b,
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    angle: l(a.angle, b.angle),
    wheels: b.wheels.map((w, i) => {
      const o = a.wheels[i] ?? w;
      return { ...w, x: l(o.x, w.x), y: l(o.y, w.y), angle: l(o.angle, w.angle) };
    }),
  };
}

class TrackScene extends Phaser.Scene {
  private cfg: SceneConfig | null = null;
  private segments = new Map<number, { x: number; y: number }[]>();
  private sky!: Phaser.GameObjects.Graphics;
  private hills!: Phaser.GameObjects.Graphics;
  private ground!: Phaser.GameObjects.Graphics;
  private cars!: Phaser.GameObjects.Graphics;
  private ruler!: Phaser.GameObjects.Graphics;
  private rulerLabels: Phaser.GameObjects.Text[] = [];
  private carLabels: Phaser.GameObjects.Text[] = [];
  private flagLabel!: Phaser.GameObjects.Text;
  private skyDirty = true;
  private refH = 0;
  private camX = 0;
  private prev: CarPose[] = [];
  private curr: CarPose[] = [];
  private recvAt = 0;
  private recvGap = 33;
  private finishedAt = new Map<string, { at: number; text: string }>();
  private measurePending = false;
  private favorites = new Set<string>();
  private pickListener: ((carId: string) => void) | null = null;
  private screenCars: { carId: string; x: number; y: number }[] = [];

  setFavorites(ids: string[]): void {
    this.favorites = new Set(ids);
  }

  onPick(listener: ((carId: string) => void) | null): void {
    this.pickListener = listener;
  }

  begin(cfg: SceneConfig): void {
    this.cfg = cfg;
    this.segments.clear();
    this.prev = [];
    this.curr = [];
    this.finishedAt.clear();
    this.favorites.clear();
    this.screenCars = [];
    this.skyDirty = true;
    this.camX = 0;
    this.refH = Number.NaN;
    this.measurePending = true;
  }

  setPoses(_simTime: number, poses: CarPose[], snap: boolean): void {
    const now = performance.now();
    this.prev = snap || this.curr.length === 0 ? poses : this.curr;
    this.curr = poses;
    this.recvGap = Math.min(100, Math.max(16, now - this.recvAt));
    this.recvAt = now;
  }

  setFlag(x: number | null): void {
    if (this.cfg) this.cfg = { ...this.cfg, flag: x };
  }

  carFinished(result: CarResult): void {
    const text = result.reason === "anomaly" ? "⚠ descalificado" : `fin · ${formatMeters(result.distance)}`;
    this.finishedAt.set(result.carId, { at: performance.now(), text });
  }

  create(): void {
    this.sky = this.add.graphics();
    this.hills = this.add.graphics();
    this.ground = this.add.graphics();
    this.cars = this.add.graphics();
    this.ruler = this.add.graphics();
    const style = { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#ffffff" };
    for (let i = 0; i < MAX_LABELS; i++) this.rulerLabels.push(this.add.text(0, 0, "", style).setVisible(false));
    for (let i = 0; i < 32; i++) {
      this.carLabels.push(
        this.add.text(0, 0, "", { ...style, fontSize: "13px", fontStyle: "bold", backgroundColor: "rgba(0,0,0,.55)", padding: { x: 4, y: 2 } }).setOrigin(0.5, 1).setVisible(false),
      );
    }
    this.flagLabel = this.add.text(0, 0, "", { ...style, fontStyle: "bold", backgroundColor: "rgba(0,0,0,.55)", padding: { x: 4, y: 2 } }).setOrigin(0, 1).setVisible(false);
    this.scale.on("resize", () => (this.skyDirty = true));
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.pickListener) return;
      let best: { carId: string; d: number } | null = null;
      for (const c of this.screenCars) {
        const d = Math.hypot(c.x - pointer.x, c.y - pointer.y);
        if (d <= PICK_RADIUS_PX && (!best || d < best.d)) best = { carId: c.carId, d };
      }
      if (best) this.pickListener(best.carId);
    });
  }

  update(): void {
    const cfg = this.cfg;
    if (!cfg || this.curr.length === 0) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const widthM = W / PX_PER_METER;
    const t = Math.min(1, (performance.now() - this.recvAt) / this.recvGap);
    const poses = this.curr.map((p, i) => mixPose(this.prev[i] ?? p, p, t));

    // La cámara sigue al líder: el coche vivo más adelantado, o el que más lejos llegó si ya terminaron todos.
    const alive = poses.filter((p) => !p.finished);
    const leader = (alive.length ? alive : poses).reduce((a, b) => (b.x > a.x ? b : a));
    this.camX = leader.x - widthM * LEADER_SCREEN_X;
    this.refH = Number.isNaN(this.refH) ? leader.y : this.refH + (leader.y - this.refH) * FOLLOW_Y;
    const toX = (x: number) => (x - this.camX) * PX_PER_METER;
    const toY = (h: number) => H * 0.6 - (h - this.refH) * PX_PER_METER;

    this.ensureSegments(widthM);
    if (this.skyDirty) this.drawSky(W, H);
    this.drawHills(W, H);
    this.drawGround(W, H, toX, toY);
    this.drawCars(poses, cfg, toX, toY);
    this.drawRuler(W, H, toX);
    this.drawFlag(cfg, toX, toY, W);

    if (this.measurePending) {
      this.measurePending = false;
      measureOnNextFrame("abrir-pista");
    }
  }

  private ensureSegments(widthM: number): void {
    const first = Math.floor(Math.max(0, this.camX - BEHIND_M) / SEGMENT_LENGTH);
    const last = Math.floor(Math.max(0, this.camX + widthM + AHEAD_M) / SEGMENT_LENGTH);
    for (const idx of [...this.segments.keys()]) if (idx < first || idx > last) this.segments.delete(idx);
    for (let i = first; i <= last; i++) if (!this.segments.has(i)) this.segments.set(i, segmentVertices(this.cfg!.track, i));
  }

  private drawSky(W: number, H: number): void {
    this.skyDirty = false;
    const pal = PALETTES[this.cfg!.track.id];
    this.sky.clear();
    const bands = 24;
    for (let i = 0; i < bands; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(pal.skyTop),
        Phaser.Display.Color.IntegerToColor(pal.skyBottom),
        100,
        Math.round((i / (bands - 1)) * 100),
      );
      this.sky.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      this.sky.fillRect(0, (H * i) / bands, W, H / bands + 1);
    }
  }

  private drawHills(W: number, H: number): void {
    const pal = PALETTES[this.cfg!.track.id];
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
  }

  private drawGround(W: number, H: number, toX: (x: number) => number, toY: (h: number) => number): void {
    const pal = PALETTES[this.cfg!.track.id];
    this.ground.clear();
    const idxs = [...this.segments.keys()].sort((a, b) => a - b);
    const line: Vec[] = [];
    for (const i of idxs) {
      const verts = this.segments.get(i)!;
      for (let k = i === idxs[0] ? 0 : 1; k < verts.length; k++) line.push(vec(toX(verts[k].x), toY(verts[k].y)));
    }
    // Antes de la salida el suelo es llano, como en la simulación.
    if (idxs[0] === 0) line.unshift(vec(-W, line[0].y));
    const body: Vec[] = [vec(line[0].x, H + 4), ...line, vec(line[line.length - 1].x, H + 4)];
    this.ground.fillStyle(pal.earth, 1).fillPoints(body, true);
    this.ground.lineStyle(5, pal.grass, 1).strokePoints(line, false, false);
    const startX = toX(0);
    if (startX > -10 && startX < W + 10) {
      const y0 = toY(this.cfg!.track.heightAt(0));
      this.ground.lineStyle(3, 0xffffff, 1).lineBetween(startX, y0, startX, y0 - 70);
      this.ground.fillStyle(0xd62828, 1).fillRect(startX, y0 - 70, 26, 16);
    }
  }

  private drawCars(poses: CarPose[], cfg: SceneConfig, toX: (x: number) => number, toY: (h: number) => number): void {
    const g = this.cars;
    g.clear();
    const now = performance.now();
    let used = 0;
    this.screenCars = [];
    poses.forEach((p, i) => {
      const car = cfg.cars.find((c) => c.carId === p.carId) ?? cfg.cars[i];
      if (!p.finished) this.screenCars.push({ carId: p.carId, x: toX(p.x), y: toY(p.y) });
      const done = p.finished;
      const fill = done ? FINISHED_GREY : hueColour(car.hue, 0.55);
      const pts = car.genome.body.map((v) => {
        const a = v.angle + p.angle;
        return vec(toX(p.x + Math.cos(a) * v.length), toY(p.y + Math.sin(a) * v.length));
      });
      g.fillStyle(fill, 1).fillPoints(pts, true);
      g.lineStyle(2, 0x1b1b1b, 1).strokePoints(pts, true, true);
      for (const w of p.wheels) {
        const cx = toX(w.x);
        const cy = toY(w.y);
        const r = w.radius * PX_PER_METER;
        g.fillStyle(done ? 0x5d6266 : 0x222222, 1).fillCircle(cx, cy, r);
        g.fillStyle(fill, 1).fillCircle(cx, cy, Math.max(2, r * 0.4));
        // El radio marcado deja ver que la rueda gira.
        g.lineStyle(2, 0xffffff, 0.9).lineBetween(cx, cy, cx + Math.cos(-w.angle) * r, cy + Math.sin(-w.angle) * r);
      }
      const top = Math.min(toY(p.y) - 22, ...p.wheels.map((w) => toY(w.y) - w.radius * PX_PER_METER - 6));
      const fin = this.finishedAt.get(p.carId);
      const estrella = this.favorites.has(p.carId) ? "★ " : "";
      let text = done ? "" : `${estrella}${car.label ?? ""}`.trim();
      if (fin) text = now - fin.at < FINISH_LABEL_MS ? fin.text : "";
      const label = this.carLabels[used];
      if (label && text) {
        label.setText(text).setPosition(toX(p.x), top).setVisible(true);
        used++;
      }
    });
    for (let i = used; i < this.carLabels.length; i++) this.carLabels[i].setVisible(false);
  }

  private drawRuler(W: number, H: number, toX: (x: number) => number): void {
    this.ruler.clear();
    this.ruler.fillStyle(0x000000, 0.45).fillRect(0, H - RULER_HEIGHT, W, RULER_HEIGHT);
    let used = 0;
    const firstTick = Math.ceil(this.camX / 10) * 10;
    for (let m = Math.max(0, firstTick); toX(m) < W && used < MAX_LABELS; m += 10) {
      const x = toX(m);
      this.ruler.lineStyle(2, 0xffffff, 0.9).lineBetween(x, H - RULER_HEIGHT, x, H - RULER_HEIGHT + 8);
      this.rulerLabels[used].setText(`${m} m`).setPosition(x + 3, H - RULER_HEIGHT + 6).setVisible(true);
      used++;
    }
    for (let i = used; i < MAX_LABELS; i++) this.rulerLabels[i].setVisible(false);
  }

  private drawFlag(cfg: SceneConfig, toX: (x: number) => number, toY: (h: number) => number, W: number): void {
    if (cfg.flag === null) {
      this.flagLabel.setVisible(false);
      return;
    }
    const x = toX(cfg.flag);
    if (x < -120 || x > W + 10) {
      this.flagLabel.setVisible(false);
      return;
    }
    const y = toY(cfg.track.heightAt(cfg.flag));
    this.cars.lineStyle(4, 0xffffff, 1).lineBetween(x, y, x, y - 90);
    this.cars.fillStyle(0xffd23f, 1).fillTriangle(x, y - 90, x + 34, y - 78, x, y - 66);
    this.flagLabel.setText(`n.º 1 · ${formatMeters(cfg.flag)}`).setPosition(x + 4, y - 94).setVisible(true);
  }
}

export function startTrackScene(parent: HTMLElement, track: Track): TrackSceneHandle {
  const scene = new TrackScene("pista");
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
    begin: (cfg) => scene.begin(cfg),
    setPoses: (t, p, s) => scene.setPoses(t, p, s),
    setFlag: (x) => scene.setFlag(x),
    carFinished: (r) => scene.carFinished(r),
    setFavorites: (ids) => scene.setFavorites(ids),
    onPick: (l) => scene.onPick(l),
    destroy: () => game.destroy(true),
  };
}
