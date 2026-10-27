import { colorNumerico, type ColorCoche } from "./colores-coche";
import Phaser from "phaser";
import { colocarMarcador, cruzan } from "./colocar-marcador";
import { createNoise2D } from "simplex-noise";
import { runtime } from "@/debug/ganchos";
import { measureOnNextFrame } from "@/debug/latencias";
import { formatMeters } from "@/app/format";
import { META_DISTANCE, TORQUE_SLOPE_DEG, type CarPose, type CarResult, type CausaParada, type FuerzasMuestra } from "@/sim/constants";
import type { Genome } from "@/sim/genome";
import { SEGMENT_LENGTH, segmentVertices } from "@/sim/terrain";
import type { Track } from "@/sim/tracks";
import { gestionarLienzo, type OpcionesGestor } from "./lienzo";
import { CONTORNO_COCHE, opacidadesCoche } from "./opacidad";
import { cssColor, PALETTES } from "./palette";
import { ASPECTO } from "./superficies";

const PX_PER_METER = 20;
const AHEAD_M = 60;
const BEHIND_M = 25;
const RULER_HEIGHT = 24;
const MAX_LABELS = 14;
const FINISH_LABEL_MS = 1500;
const LEADER_SCREEN_X = 0.3;
const FOLLOW_Y = 0.1;
const FOLLOW_Y_PARADO = 0.5;
// Con la carrera parada por una causa, el suelo sube en pantalla: la tarjeta de fin ocupa la mitad de abajo y el marcador tiene que quedar en la de arriba.
const ANCLA_CARRERA = 0.6;
const ANCLA_PARADA = 0.4;
const PLACA = "#111111";
const TEXTO_PLACA = "#ffffff";
const ETIQUETA_PX = 16;
const MARGEN_MARCADOR_M = 3;
const ICONOS: Record<CausaParada, string> = { motor: "", agarre: "", vuelco: "↻", "sin-apoyo": "⤓", panza: "▁", obstaculo: "▮", rotura: "✕" };
const FINISHED_GREY = 0x8a8f94;
// Radio de acierto de un toque: un dedo no apunta a un coche de 2 m a 20 px/m.
const PICK_RADIUS_PX = 48;
// Capa «Fuerzas»: los mismos colores que «Ver fuerzas» del Taller (fuerza en rosa, par en menta).
const ROSA_FUERZA = 0xff5d73;
const MENTA_PAR = 0x6df0c2;
// Escala fija para que dos momentos se comparen a ojo: 1 px por cada 20 N, con tope.
const N_POR_PX = 20;
const TOPE_FLECHA_PX = 120;
// Par que llena el arco entero, como en el Taller.
const PAR_ARCO_COMPLETO = 600;
// Constante de tiempo de la media móvil exponencial: las piedras se leen sin que la flecha tiemble.
const SUAVIZADO_FUERZA_MS = 150;

/** Contorno del color, 3 px hacia dentro: el contorno oscuro y el trazo del color van uno junto al otro. */
function interior(pts: Vec[], cx: number, cy: number): Vec[] {
  return pts.map((q) => {
    const d = Math.hypot(q.x - cx, q.y - cy) || 1;
    const k = Math.max(0, d - 3) / d;
    return vec(cx + (q.x - cx) * k, cy + (q.y - cy) * k);
  });
}

const farNoise = createNoise2D(() => 0.31);

export interface SceneCar {
  carId: string;
  genome: Genome;
  /** 0..360, el color con el que se pinta el coche mientras corre. */
  hue: number;
  /** Color de paleta del coche; si falta se usa el tono. */
  color?: ColorCoche;
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
  /** Capa «Fuerzas»: enciende o apaga el dibujo de las flechas y los arcos. */
  activarFuerzas(on: boolean): void;
  /** Última muestra del coche líder (null si el worker no manda ninguna: capa apagada o coche terminado). */
  setFuerzas(muestra: FuerzasMuestra | null): void;
  /** Los coches con estrella ★ encima (los favoritos de la generación en curso). */
  setFavorites(ids: string[]): void;
  /** Dónde cayó cada coche en el último frame pintado: la batalla indica con una flecha los que quedan fuera de pantalla. */
  vistaCoches(): { carId: string; enPantalla: boolean }[];
  /** Avisa del coche vivo que ha tocado el jugador (el más cercano al dedo, con margen para un dedo). */
  onPick(listener: ((carId: string) => void) | null): void;
  destroy(): void;
}

type Vec = Phaser.Math.Vector2;
const vec = (x: number, y: number): Vec => new Phaser.Math.Vector2(x, y);

/** El destello dura 300 ms de reloj real aunque la carrera vaya a ×8: lo que se ve no puede depender del ritmo. */
const DESTELLO_MS = 300;
const DESTELLO_M = 0.6;
const DESTELLO_CONTORNO = 0x0c0c0c;
const DESTELLO_BLANCO = 0xffffff;
const DESTELLO_AMARILLO = 0xffd400;

/** Estrella de ocho puntas: radio exterior r, interior r/2. */
function puntosEstrella(cx: number, cy: number, r: number): Vec[] {
  const pts: Vec[] = [];
  for (let k = 0; k < 16; k++) {
    const rr = k % 2 === 0 ? r : r / 2;
    const a = (k * Math.PI) / 8;
    pts.push(vec(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr));
  }
  return pts;
}

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
  /** Caja local (px del lienzo) del rótulo «fin · N m» del primer coche en este frame; null si no se ve. */
  private cajaEtiquetaFin: { x: number; y: number; w: number; h: number } | null = null;
  private flagLabel!: Phaser.GameObjects.Text;
  private destellos: { x: number; y: number; at: number }[] = [];
  private skyDirty = true;
  private refH = 0;
  private camX = 0;
  private prev: CarPose[] = [];
  private curr: CarPose[] = [];
  private recvAt = 0;
  private recvGap = 33;
  private finishedAt = new Map<string, { at: number; text: string }>();
  private measurePending = false;
  private marca!: Phaser.GameObjects.Graphics;
  private etiquetaCausa!: Phaser.GameObjects.Text;
  private etiquetaLimite!: Phaser.GameObjects.Text;
  private parada: { x: number; causa: CausaParada; pendiente: number | null } | null = null;
  private ancla = ANCLA_CARRERA;
  private favorites = new Set<string>();
  private pickListener: ((carId: string) => void) | null = null;
  private screenCars: { carId: string; x: number; y: number }[] = [];
  private vista: { carId: string; enPantalla: boolean }[] = [];
  private fuerzasActivas = false;
  private muestraFuerzas: FuerzasMuestra | null = null;
  /** Valores ya suavizados que se pintan: fx, fy en N y par en N·m por rueda. */
  private suaveFuerzas: { carId: string; ruedas: { fx: number; fy: number; par: number }[] } | null = null;
  private ultimoFrameFuerzas = 0;
  private medirFuerzas = false;
  private etiquetaFuerza!: Phaser.GameObjects.Text;
  private etiquetaPar!: Phaser.GameObjects.Text;

  activarFuerzas(on: boolean): void {
    this.fuerzasActivas = on;
    if (!on) {
      this.muestraFuerzas = null;
      this.suaveFuerzas = null;
    }
    this.medirFuerzas = true;
  }

  setFuerzas(muestra: FuerzasMuestra | null): void {
    this.muestraFuerzas = this.fuerzasActivas ? muestra : null;
  }

  setFavorites(ids: string[]): void {
    this.favorites = new Set(ids);
  }

  /** Recoge de la escena anterior lo que sabe de la carrera para seguir donde iba tras rehacer el juego. */
  traspasar(otra: TrackScene): void {
    this.cfg = otra.cfg;
    this.prev = otra.prev;
    this.curr = otra.curr;
    this.recvAt = otra.recvAt;
    this.recvGap = otra.recvGap;
    this.finishedAt = otra.finishedAt;
    this.parada = otra.parada;
    this.fuerzasActivas = otra.fuerzasActivas;
    this.muestraFuerzas = otra.muestraFuerzas;
    this.suaveFuerzas = otra.suaveFuerzas;
    this.ancla = otra.ancla;
    this.favorites = otra.favorites;
    this.pickListener = otra.pickListener;
    this.camX = otra.camX;
    // Sin NaN la escena nueva arranca con la altura de referencia en 0 y tarda en subir por la cuesta: el coche quedaba fuera de plano.
    // Con NaN el primer frame encuadra al líder directamente.
    this.refH = Number.NaN;
    this.skyDirty = true;
    this.destellos = otra.destellos;
  }

  vistaCoches(): { carId: string; enPantalla: boolean }[] {
    return this.vista;
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
    this.parada = null;
    this.ancla = ANCLA_CARRERA;
    runtime.marcador = null;
    runtime.etiquetaFin = null;
    runtime.cajaCoche = null;
    this.favorites.clear();
    this.screenCars = [];
    this.muestraFuerzas = null;
    this.suaveFuerzas = null;
    this.skyDirty = true;
    this.camX = 0;
    this.refH = Number.NaN;
    this.measurePending = true;
  }

  setPoses(_simTime: number, poses: CarPose[], snap: boolean): void {
    const now = performance.now();
    this.prev = snap || this.curr.length === 0 ? poses : this.curr;
    this.curr = poses;
    // Los destellos se anotan al recibir la pose, no al pintar: cada rotura llega en una sola pose.
    for (const p of poses) for (const r of p.roturas ?? []) this.destellos.push({ x: r.x, y: r.y, at: now });
    this.recvGap = Math.min(100, Math.max(16, now - this.recvAt));
    this.recvAt = now;
  }

  setFlag(x: number | null): void {
    if (this.cfg) this.cfg = { ...this.cfg, flag: x };
  }

  carFinished(result: CarResult): void {
    const text = result.reason === "anomaly" ? "⚠ descalificado" : `fin · ${formatMeters(result.distance)}`;
    this.finishedAt.set(result.carId, { at: performance.now(), text });
    // El marcador solo existe en la Pista (un coche): en la evolución hay decenas y no cabría ninguno.
    if (this.cfg?.cars.length === 1 && result.reason === "stall" && result.causaParada) {
      this.parada = { x: result.distance, causa: result.causaParada, pendiente: result.pendienteParada };
    } else {
      // forzarTarjetaFin reaplica carFinished con otro motivo: el marcador anterior ya no vale.
      this.parada = null;
    }
  }

  create(): void {
    this.sky = this.add.graphics();
    this.hills = this.add.graphics();
    this.ground = this.add.graphics();
    this.cars = this.add.graphics();
    this.marca = this.add.graphics();
    this.ruler = this.add.graphics();
    const style = { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#ffffff" };
    for (let i = 0; i < MAX_LABELS; i++) this.rulerLabels.push(this.add.text(0, 0, "", style).setVisible(false));
    for (let i = 0; i < 32; i++) {
      this.carLabels.push(
        this.add.text(0, 0, "", { ...style, fontSize: "13px", fontStyle: "bold", backgroundColor: "rgba(0,0,0,.55)", padding: { x: 4, y: 2 } }).setOrigin(0.5, 1).setVisible(false),
      );
    }
    this.flagLabel = this.add.text(0, 0, "", { ...style, fontStyle: "bold", backgroundColor: "rgba(0,0,0,.55)", padding: { x: 4, y: 2 } }).setOrigin(0, 1).setVisible(false);
    const placa = { ...style, fontSize: `${ETIQUETA_PX}px`, fontStyle: "bold", color: TEXTO_PLACA, backgroundColor: PLACA, padding: { x: 6, y: 3 } };
    this.etiquetaCausa = this.add.text(0, 0, "", placa).setOrigin(0.5, 1).setVisible(false);
    this.etiquetaLimite = this.add.text(0, 0, "", placa).setOrigin(0, 0.5).setVisible(false);
    const etiquetaCapa = { ...style, fontSize: "13px", fontStyle: "bold", stroke: "#0c0c0c", strokeThickness: 3 };
    this.etiquetaFuerza = this.add.text(0, 0, "fuerza", { ...etiquetaCapa, color: "#ff5d73" }).setVisible(false);
    this.etiquetaPar = this.add.text(0, 0, "par", { ...etiquetaCapa, color: "#6df0c2" }).setVisible(false);
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
    const parado = Boolean(this.parada && leader.finished);
    // Con el coche parado el suavizado es por fotograma y en un equipo lento tarda segundos en dejar el marcador a la vista: se acorta.
    const sigue = parado ? FOLLOW_Y_PARADO : FOLLOW_Y;
    this.refH = Number.isNaN(this.refH) ? leader.y : Math.abs(leader.y - this.refH) < 0.01 && parado ? leader.y : this.refH + (leader.y - this.refH) * sigue;
    const objetivo = parado ? ANCLA_PARADA : ANCLA_CARRERA;
    this.ancla = Math.abs(objetivo - this.ancla) < 0.002 ? objetivo : this.ancla + (objetivo - this.ancla) * (parado ? 0.5 : 0.1);
    const toX = (x: number) => (x - this.camX) * PX_PER_METER;
    const toY = (h: number) => H * this.ancla - (h - this.refH) * PX_PER_METER;

    this.ensureSegments(widthM);
    if (this.skyDirty) this.drawSky(W, H);
    this.drawHills(W, H);
    this.drawGround(W, H, toX, toY);
    this.drawCars(poses, cfg, toX, toY);
    this.drawFuerzas(poses, toX, toY);
    this.drawMarcador(cfg, poses, toX, toY);
    this.drawRuler(W, H, toX);
    this.drawFlag(cfg, toX, toY, W);
    this.drawMeta(cfg, toX, toY, W);

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
    this.drawSuperficies(idxs, toX, toY);
    const startX = toX(0);
    if (startX > -10 && startX < W + 10) {
      const y0 = toY(this.cfg!.track.heightAt(0));
      this.ground.lineStyle(3, 0xffffff, 1).lineBetween(startX, y0, startX, y0 - 70);
      this.ground.fillStyle(0xd62828, 1).fillRect(startX, y0 - 70, 26, 16);
    }
  }

  // Hielo y elástico se distinguen por forma (brillos, zigzag) además de por color.
  private drawSuperficies(idxs: number[], toX: (x: number) => number, toY: (h: number) => number): void {
    const track = this.cfg!.track;
    for (const i of idxs) {
      const aspecto = ASPECTO[track.surfaceOfSegment(i).tipo];
      if (aspecto.color === null) continue;
      const pts = this.segments.get(i)!.map((v) => vec(toX(v.x), toY(v.y)));
      this.ground.lineStyle(9, aspecto.contorno, 1).strokePoints(pts, false, false);
      this.ground.lineStyle(5, aspecto.color, 1).strokePoints(pts, false, false);
      if (aspecto.patron === "brillos") {
        // Una chispa en cruz cada 2 m sobre la franja.
        this.ground.lineStyle(2, aspecto.color, 1);
        for (let k = 2; k < pts.length - 1; k += 4) {
          const p = pts[k];
          this.ground.lineBetween(p.x - 5, p.y - 10, p.x + 5, p.y - 10).lineBetween(p.x, p.y - 15, p.x, p.y - 5);
        }
      } else if (aspecto.patron === "zigzag") {
        const zig: Vec[] = [];
        pts.forEach((p, k) => zig.push(vec(p.x, p.y - (k % 2 === 0 ? 4 : 14))));
        this.ground.lineStyle(3, aspecto.contorno, 1).strokePoints(zig, false, false);
        this.ground.lineStyle(1.5, aspecto.color, 1).strokePoints(zig, false, false);
      }
    }
  }

  private drawCars(poses: CarPose[], cfg: SceneConfig, toX: (x: number) => number, toY: (h: number) => number): void {
    this.cajaEtiquetaFin = null;
    const g = this.cars;
    g.clear();
    const now = performance.now();
    let used = 0;
    this.screenCars = [];
    const ancho = this.scale.width;
    this.vista = poses.map((p) => ({ carId: p.carId, enPantalla: toX(p.x) >= 0 && toX(p.x) <= ancho }));
    const etiquetasPuestas: { x: number; y: number; w: number; h: number }[] = [];
    poses.forEach((p, i) => {
      const car = cfg.cars.find((c) => c.carId === p.carId) ?? cfg.cars[i];
      if (!p.finished) this.screenCars.push({ carId: p.carId, x: toX(p.x), y: toY(p.y) });
      const done = p.finished;
      const fill = done ? FINISHED_GREY : car.color ? colorNumerico(car.color) : hueColour(car.hue, 0.55);
      const pts = car.genome.body.map((v) => {
        const a = v.angle + p.angle;
        return vec(toX(p.x + Math.cos(a) * v.length), toY(p.y + Math.sin(a) * v.length));
      });
      // Cada triángulo (centro + dos vértices) se pinta con su opacidad; el contorno va aparte, opaco.
      const opac = opacidadesCoche(car.genome, p.cargas);
      if (i === 0) runtime.opacidades = opac;
      const cx0 = toX(p.x);
      const cy0 = toY(p.y);
      const mascara = p.piezas ?? 255;
      pts.forEach((a, k) => {
        if ((mascara & (1 << k)) === 0) return;
        const b = pts[(k + 1) % pts.length];
        g.fillStyle(fill, opac[k]).fillTriangle(cx0, cy0, a.x, a.y, b.x, b.y);
      });
      // Con color de paleta: contorno oscuro de 3 px y trazo interior de 2 px del color, opacos los dos.
      const contorno = car.color && !done ? 3 : 2;
      if (mascara === 255) {
        g.lineStyle(contorno, CONTORNO_COCHE, 1).strokePoints(pts, true, true);
        if (car.color && !done) g.lineStyle(2, fill, 1).strokePoints(interior(pts, cx0, cy0), true, true);
      }
      else {
        // Con triángulos perdidos solo se contornea lo que queda: el hueco se ve como hueco.
        g.lineStyle(2, CONTORNO_COCHE, 1);
        pts.forEach((a, k) => {
          if ((mascara & (1 << k)) === 0) return;
          const b = pts[(k + 1) % pts.length];
          g.lineBetween(cx0, cy0, a.x, a.y).lineBetween(a.x, a.y, b.x, b.y).lineBetween(b.x, b.y, cx0, cy0);
        });
      }
      for (const s of p.sueltas ?? []) {
        const loc = (k: number) => {
          const v = car.genome.body[k % car.genome.body.length];
          return { x: Math.cos(v.angle) * v.length, y: Math.sin(v.angle) * v.length };
        };
        const rot = (q: { x: number; y: number }) => vec(toX(s.x + q.x * Math.cos(s.angle) - q.y * Math.sin(s.angle)), toY(s.y + q.x * Math.sin(s.angle) + q.y * Math.cos(s.angle)));
        const tri = [rot({ x: 0, y: 0 }), rot(loc(s.i)), rot(loc(s.i + 1))];
        g.fillStyle(fill, 0.9).fillTriangle(tri[0].x, tri[0].y, tri[1].x, tri[1].y, tri[2].x, tri[2].y);
        g.lineStyle(2, CONTORNO_COCHE, 1).strokePoints(tri, true, true);
      }
      if (i === 0) {
        runtime.piezas = mascara;
        runtime.sueltas = (p.sueltas?.length ?? 0) + p.wheels.filter((w) => w.suelta && !w.fuera).length;
      }
      for (const w of p.wheels) {
        if (w.fuera) continue;
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
        // Coches que salen juntos (batalla): las etiquetas que se pisan se apilan hacia arriba, una sobre otra, para que se lean todas.
        const caja = label.getBounds();
        let sube = 0;
        for (let guard = 0; guard < 8; guard++) {
          const y0 = caja.y - sube;
          const choca = etiquetasPuestas.find((r) => caja.x < r.x + r.w && r.x < caja.x + caja.width && y0 < r.y + r.h && r.y < y0 + caja.height);
          if (!choca) break;
          sube = caja.y + caja.height - choca.y + 2;
        }
        if (sube > 0) label.setPosition(toX(p.x), top - sube);
        etiquetasPuestas.push({ x: caja.x, y: caja.y - sube, w: caja.width, h: caja.height });
        if (i === 0 && fin) {
          const b = label.getBounds();
          this.cajaEtiquetaFin = { x: b.x, y: b.y, w: b.width, h: b.height };
        }
        used++;
      }
    });
    for (let i = used; i < this.carLabels.length; i++) this.carLabels[i].setVisible(false);
    this.destellos = this.destellos.filter((d) => now - d.at < DESTELLO_MS);
    runtime.destellos = this.destellos.length;
    for (const d of this.destellos) {
      // Contorno oscuro bajo la estrella blanca y amarilla: se lee sobre cielo claro y sobre suelo oscuro.
      const r = (DESTELLO_M * PX_PER_METER) / 2;
      const cx = toX(d.x);
      const cy = toY(d.y);
      g.fillStyle(DESTELLO_CONTORNO, 1).fillPoints(puntosEstrella(cx, cy, r + 3), true);
      g.fillStyle(DESTELLO_BLANCO, 1).fillPoints(puntosEstrella(cx, cy, r), true);
      g.fillStyle(DESTELLO_AMARILLO, 1).fillPoints(puntosEstrella(cx, cy, r * 0.55), true);
    }
  }

  /** Arcos de par mínimos sobre las ruedas del coche en cabeza (el de la muestra del Worker): el primer frame ya enseña la capa y mide la latencia del interruptor. */
  private dibujarEsqueletoFuerzas(poses: CarPose[], toX: (x: number) => number, toY: (h: number) => number): void {
    const g = this.cars;
    const lider = poses.filter((p) => !p.finished).reduce<CarPose | null>((a, p) => (!a || (p.wheels[0]?.x ?? 0) > (a.wheels[0]?.x ?? 0) ? p : a), null);
    lider?.wheels.forEach((w) => {
      if (w.fuera || w.suelta) return;
      const cx = toX(w.x);
      const cy = toY(w.y);
      const radio = w.radius * PX_PER_METER + 9;
      const inicio = -Math.PI * 0.9;
      g.lineStyle(7, 0x0c0c0c, 1).beginPath().arc(cx, cy, radio, inicio, inicio + 0.35, false).strokePath();
      g.lineStyle(4, MENTA_PAR, 1).beginPath().arc(cx, cy, radio, inicio, inicio + 0.35, false).strokePath();
    });
    if (this.medirFuerzas) {
      this.medirFuerzas = false;
      measureOnNextFrame("fuerzas-carrera");
    }
  }

  /**
   * Flecha de fuerza y arco de par de cada rueda del coche que sigue la cámara. Lo que se pinta es la media
   * móvil de lo que mide el Worker, no la última muestra: así el ritmo de dibujado no cambia lo que se ve.
   */
  private drawFuerzas(poses: CarPose[], toX: (x: number) => number, toY: (h: number) => number): void {
    const g = this.cars;
    const m = this.muestraFuerzas;
    const ahora = performance.now();
    const dt = Math.min(500, Math.max(0, ahora - this.ultimoFrameFuerzas));
    this.ultimoFrameFuerzas = ahora;
    this.etiquetaFuerza.setVisible(false);
    this.etiquetaPar.setVisible(false);
    const pose = m ? poses.find((p) => p.carId === m.carId) : undefined;
    if (this.fuerzasActivas && !m) {
      // La primera muestra viaja al Worker y vuelve: mientras, el frame siguiente al clic ya enseña la capa (arcos de par sin valor), para que el interruptor responda dentro de un frame.
      this.dibujarEsqueletoFuerzas(poses, toX, toY);
      runtime.fuerzasEnVivo.flechasPx = [];
      return;
    }
    if (!this.fuerzasActivas || !m || !pose || pose.finished) {
      runtime.fuerzasEnVivo.flechasPx = [];
      if (this.medirFuerzas && !this.fuerzasActivas) {
        this.medirFuerzas = false;
        measureOnNextFrame("fuerzas-carrera");
      }
      return;
    }
    let suave = this.suaveFuerzas;
    if (!suave || suave.carId !== m.carId || suave.ruedas.length !== m.ruedas.length) {
      // Coche nuevo: arranca en su valor real, sin deslizarse desde cero.
      suave = { carId: m.carId, ruedas: m.ruedas.map((r) => ({ fx: r.fx, fy: r.fy, par: Math.abs(r.parMotor) })) };
    } else {
      const k = 1 - Math.exp(-dt / SUAVIZADO_FUERZA_MS);
      m.ruedas.forEach((r, i) => {
        const s = suave!.ruedas[i];
        s.fx += (r.fx - s.fx) * k;
        s.fy += (r.fy - s.fy) * k;
        s.par += (Math.abs(r.parMotor) - s.par) * k;
      });
    }
    this.suaveFuerzas = suave;
    const largos: number[] = [];
    let primera = true;
    pose.wheels.forEach((w, i) => {
      const r = m.ruedas[i];
      if (!r || !r.activa || w.fuera || w.suelta) {
        largos.push(0);
        return;
      }
      const s = suave!.ruedas[i];
      const cx = toX(w.x);
      const cy = toY(w.y);
      const len = Math.hypot(s.fx, s.fy) / N_POR_PX;
      const escala = len > TOPE_FLECHA_PX ? TOPE_FLECHA_PX / len : 1;
      // En pantalla el eje y baja: la componente vertical se invierte.
      const dx = (s.fx / N_POR_PX) * escala;
      const dy = (-s.fy / N_POR_PX) * escala;
      const largo = Math.hypot(dx, dy);
      largos.push(largo);
      if (largo >= 3) {
        const x2 = cx + dx;
        const y2 = cy + dy;
        g.lineStyle(6, 0x0c0c0c, 1).lineBetween(cx, cy, x2, y2);
        g.lineStyle(4, ROSA_FUERZA, 1).lineBetween(cx, cy, x2, y2);
        const ang = Math.atan2(dy, dx);
        const p = (da: number) => ({ x: x2 - Math.cos(ang + da) * 11, y: y2 - Math.sin(ang + da) * 11 });
        const a = p(0.45);
        const b = p(-0.45);
        g.fillStyle(ROSA_FUERZA, 1).fillTriangle(x2, y2, a.x, a.y, b.x, b.y);
        g.lineStyle(1.5, 0x0c0c0c, 1).strokeTriangle(x2, y2, a.x, a.y, b.x, b.y);
        if (primera) this.etiquetaFuerza.setPosition(x2 + 6, y2 - 8).setVisible(true);
      }
      // Arco de par alrededor de la rueda: gira en el sentido en que rueda, como en el Taller.
      const radio = w.radius * PX_PER_METER + 9;
      const inicio = -Math.PI * 0.9;
      const barrido = Math.max(0.35, Math.min(1.7 * Math.PI, (s.par / PAR_ARCO_COMPLETO) * 1.7 * Math.PI));
      g.lineStyle(7, 0x0c0c0c, 1).beginPath().arc(cx, cy, radio, inicio, inicio + barrido, false).strokePath();
      g.lineStyle(4, MENTA_PAR, 1).beginPath().arc(cx, cy, radio, inicio, inicio + barrido, false).strokePath();
      const fin = inicio + barrido;
      const px = cx + Math.cos(fin) * radio;
      const py = cy + Math.sin(fin) * radio;
      const tx = -Math.sin(fin);
      const ty = Math.cos(fin);
      g.fillStyle(MENTA_PAR, 1).fillTriangle(px + tx * 10, py + ty * 10, px - ty * 7, py + tx * 7, px + ty * 7, py - tx * 7);
      if (primera) this.etiquetaPar.setPosition(cx + Math.cos(inicio) * radio - 26, cy + Math.sin(inicio) * radio - 18).setVisible(true);
      primera = false;
    });
    runtime.fuerzasEnVivo.flechasPx = largos;
    if (this.medirFuerzas) {
      this.medirFuerzas = false;
      measureOnNextFrame("fuerzas-carrera");
    }
  }

  /** Caja del coche en px CSS: el marcador se dimensiona contra ella y las pruebas comprueban que nada se cruza. */
  private cajaDelCoche(pose: CarPose, genome: Genome, toX: (x: number) => number, toY: (h: number) => number): { x: number; y: number; w: number; h: number } {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const v of genome.body) {
      const a = v.angle + pose.angle;
      xs.push(toX(pose.x + Math.cos(a) * v.length));
      ys.push(toY(pose.y + Math.sin(a) * v.length));
    }
    for (const w of pose.wheels) {
      const r = w.radius * PX_PER_METER;
      xs.push(toX(w.x) - r, toX(w.x) + r);
      ys.push(toY(w.y) - r, toY(w.y) + r);
    }
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  private drawMarcador(cfg: SceneConfig, poses: CarPose[], toX: (x: number) => number, toY: (h: number) => number): void {
    const g = this.marca;
    g.clear();
    this.etiquetaCausa.setVisible(false);
    this.etiquetaLimite.setVisible(false);
    const canvas = this.game.canvas.getBoundingClientRect();
    const pose = cfg.cars.length === 1 ? poses[0] : undefined;
    const coche = pose ? this.cajaDelCoche(pose, cfg.cars[0].genome, toX, toY) : null;
    const eti = this.cajaEtiquetaFin;
    runtime.etiquetaFin = eti ? { x: canvas.left + eti.x, y: canvas.top + eti.y, w: eti.w, h: eti.h } : null;
    runtime.cajaCoche = coche ? { x: canvas.left + coche.x, y: canvas.top + coche.y, w: coche.w, h: coche.h } : null;
    const p = this.parada;
    if (!p || !pose?.finished || !coche) {
      runtime.marcador = null;
      return;
    }
    const rotulo = this.cajaEtiquetaFin;
    // Si el coche resbaló cuesta abajo tras su punto más lejano, el marcador se acerca a él: más allá cae fuera de la pantalla.
    const xMarca = Math.min(p.x, pose.x + MARGEN_MARCADOR_M);
    const base = { x: toX(xMarca), y: toY(cfg.track.heightAt(xMarca)) };
    const conPendiente = (p.causa === "motor" || p.causa === "agarre") && p.pendiente !== null;
    let caja = { x: base.x, y: base.y, w: 0, h: 0 };
    let altoCuna = 0;
    if (conPendiente) {
      // La cuña va por delante del coche: en el suelo que no pudo subir, donde se ve la inclinación.
      const real = (Math.max(1, Math.min(89, p.pendiente as number)) * Math.PI) / 180;
      const limite = (TORQUE_SLOPE_DEG * Math.PI) / 180;
      altoCuna = Math.max(coche.h * 1.2, 56);
      const largo = altoCuna / Math.sin(real);
      const top = { x: base.x + largo * Math.cos(real), y: base.y - altoCuna };
      const finLimite = { x: base.x + largo * Math.cos(limite), y: base.y - largo * Math.sin(limite) };
      g.fillStyle(0xffd23f, 0.35).fillTriangle(base.x, base.y, top.x, base.y, top.x, top.y);
      g.lineStyle(3, 0xffd23f, 1).lineBetween(base.x, base.y, top.x, top.y);
      g.lineStyle(2, 0xffffff, 1).lineBetween(top.x, base.y, top.x, top.y).lineBetween(base.x, base.y, top.x, base.y);
      // Discontinua a mano: Phaser no dibuja trazos.
      const paso = 10;
      const n = Math.floor(largo / paso);
      for (let i = 0; i < n; i += 2) {
        const a = (i * paso) / largo;
        const b = Math.min(1, ((i + 1) * paso) / largo);
        g.lineBetween(base.x + (finLimite.x - base.x) * a, base.y + (finLimite.y - base.y) * a, base.x + (finLimite.x - base.x) * b, base.y + (finLimite.y - base.y) * b);
      }
      this.etiquetaLimite.setText(`${TORQUE_SLOPE_DEG}°`).setPosition(finLimite.x + 4, finLimite.y).setVisible(true);
      this.etiquetaCausa.setText(`${Math.round(p.pendiente as number)}°`).setPosition(top.x, top.y - 4).setVisible(true);
      // Las placas de la cuña tampoco tapan el rótulo «fin · N m»: la del ángulo real sube sobre él y la del límite se aparta a su derecha.
      this.etiquetaCausa.setOrigin(0.5, 1);
      const cajaDe = (b: Phaser.Geom.Rectangle) => ({ x: b.x, y: b.y, w: b.width, h: b.height });
      if (rotulo && cruzan(cajaDe(this.etiquetaCausa.getBounds()), rotulo)) this.etiquetaCausa.setPosition(top.x, rotulo.y - 4);
      if (rotulo && cruzan(cajaDe(this.etiquetaLimite.getBounds()), rotulo)) this.etiquetaLimite.setPosition(rotulo.x + rotulo.w + 4, finLimite.y);
      const lim = this.etiquetaLimite.getBounds();
      const eti = this.etiquetaCausa.getBounds();
      const x0 = Math.min(base.x, eti.x, lim.x);
      const y0 = Math.min(top.y, eti.y);
      const x1 = Math.max(top.x, eti.right, lim.right);
      caja = { x: x0, y: y0, w: x1 - x0, h: base.y - y0 };
    } else {
      const icono = ICONOS[p.causa] || "?";
      this.etiquetaCausa.setText(icono).setOrigin(0, 0).setVisible(true);
      const tam = this.etiquetaCausa.getBounds();
      // Fuera del rótulo y del coche, y siempre junto a él (colocarMarcador).
      const sitio = colocarMarcador(coche, rotulo, { w: this.scale.width, h: this.scale.height }, { w: tam.width, h: tam.height });
      this.etiquetaCausa.setPosition(sitio.x, sitio.y);
      caja = sitio;
      altoCuna = coche.h;
    }
    runtime.marcador = {
      caja: { x: canvas.left + caja.x, y: canvas.top + caja.y, w: caja.w, h: caja.h },
      tamEtiquetaPx: ETIQUETA_PX,
      colorPlaca: PLACA,
      colorTexto: TEXTO_PLACA,
      altoCochePx: coche.h,
      altoCunaPx: altoCuna,
    };
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

  /** Bandera a cuadros en META_DISTANCE: la carrera acaba ahí en cualquier pista. */
  private drawMeta(cfg: SceneConfig, toX: (x: number) => number, toY: (h: number) => number, W: number): void {
    const x = toX(META_DISTANCE);
    if (x < -60 || x > W + 10) {
      runtime.metaX = null;
      return;
    }
    runtime.metaX = x;
    const y = toY(cfg.track.heightAt(META_DISTANCE));
    const ALTO = 120;
    const COLS = 6;
    const FILAS = 4;
    const LADO = 9;
    this.cars.lineStyle(4, 0xffffff, 1).lineBetween(x, y, x, y - ALTO);
    for (let f = 0; f < FILAS; f++) {
      for (let c = 0; c < COLS; c++) {
        this.cars.fillStyle((f + c) % 2 === 0 ? 0x111111 : 0xffffff, 1).fillRect(x + 2 + c * LADO, y - ALTO + f * LADO, LADO, LADO);
      }
    }
    this.cars.lineStyle(2, 0x111111, 1).strokeRect(x + 2, y - ALTO, COLS * LADO, FILAS * LADO);
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

export function startTrackScene(parent: HTMLElement, track: Track, opciones: OpcionesGestor = {}): TrackSceneHandle {
  let scene = new TrackScene("pista");
  const gestor = gestionarLienzo(
    parent,
    (reconstruccion) => {
      if (reconstruccion) {
        const vieja = scene;
        scene = new TrackScene("pista");
        scene.traspasar(vieja);
      }
      return new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        backgroundColor: cssColor(PALETTES[track.id].skyTop),
        // preserveDrawingBuffer deja leer el lienzo en las pruebas de pantalla.
        render: { preserveDrawingBuffer: true },
        scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 360, height: parent.clientHeight || 640 },
        scene,
      });
    },
    opciones,
  );
  return {
    begin: (cfg) => scene.begin(cfg),
    setPoses: (t, p, s) => scene.setPoses(t, p, s),
    setFlag: (x) => scene.setFlag(x),
    carFinished: (r) => scene.carFinished(r),
    activarFuerzas: (on) => scene.activarFuerzas(on),
    setFuerzas: (m) => scene.setFuerzas(m),
    setFavorites: (ids) => scene.setFavorites(ids),
    vistaCoches: () => scene.vistaCoches(),
    onPick: (l) => scene.onPick(l),
    destroy: () => gestor.destruir(),
  };
}
