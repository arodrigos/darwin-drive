import Phaser from "phaser";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { VERTEX_COUNT, type Genome } from "@/sim/genome";
import { moveVertex, toggleWheel, wheelAt } from "./editor";

const HANDLE_DIAMETER = 44;
// Por debajo de este recorrido un gesto es un toque (poner o quitar rueda), no un arrastre.
const TAP_SLOP_PX = 8;
const BODY_COLOUR = 0xe9a23b;
const SKY = 0x16222f;

export interface WorkshopHandle {
  /** El genoma y la rueda seleccionada que debe pintar. */
  setState(genome: Genome, selectedSlot: number | null): void;
  destroy(): void;
}

export interface WorkshopCallbacks {
  /** Siempre un genoma normalizado: el editor no emite otra cosa. */
  onGenome(genome: Genome, selectedSlot: number | null): void;
  /** Primer gesto del jugador (cierra la ayuda inicial). */
  onGesture(): void;
}

class WorkshopScene extends Phaser.Scene {
  genome: Genome | null = null;
  selected: number | null = null;
  private g!: Phaser.GameObjects.Graphics;
  private dirty = true;
  pendingMeasure: string | null = null;

  create(): void {
    this.cameras.main.setBackgroundColor(SKY);
    this.g = this.add.graphics();
    this.scale.on("resize", () => (this.dirty = true));
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Metros → píxeles: el coche más grande cabe siempre, en cualquier lienzo. */
  get scale_(): number {
    return Math.min(this.scale.width, this.scale.height) / 7;
  }

  toScreen(x: number, y: number): { px: number; py: number } {
    const s = this.scale_;
    return { px: this.scale.width / 2 + x * s, py: this.scale.height / 2 - y * s };
  }

  toMeters(px: number, py: number): { x: number; y: number } {
    const s = this.scale_;
    return { x: (px - this.scale.width / 2) / s, y: -(py - this.scale.height / 2) / s };
  }

  vertexScreen(genome: Genome, i: number): { px: number; py: number } {
    const v = genome.body[i];
    return this.toScreen(Math.cos(v.angle) * v.length, Math.sin(v.angle) * v.length);
  }

  /** Asa más cercana al punto, si cae dentro de los 44 px del asa. */
  hit(px: number, py: number): number {
    if (!this.genome) return -1;
    let best = -1;
    let bestD = HANDLE_DIAMETER / 2;
    for (let i = 0; i < VERTEX_COUNT; i++) {
      const p = this.vertexScreen(this.genome, i);
      const d = Math.hypot(p.px - px, p.py - py);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  update(): void {
    if (!this.dirty || !this.genome) return;
    this.dirty = false;
    const genome = this.genome;
    const s = this.scale_;
    const g = this.g;
    g.clear();
    // Cuadrícula de un metro: da la escala a lo que se arrastra.
    g.lineStyle(1, 0xffffff, 0.08);
    for (let m = -4; m <= 4; m++) {
      const a = this.toScreen(m, -4);
      const b = this.toScreen(m, 4);
      g.lineBetween(a.px, a.py, b.px, b.py);
      const c = this.toScreen(-4, m);
      const d = this.toScreen(4, m);
      g.lineBetween(c.px, c.py, d.px, d.py);
    }
    const pts = genome.body.map((_, i) => {
      const p = this.vertexScreen(genome, i);
      return new Phaser.Math.Vector2(p.px, p.py);
    });
    g.fillStyle(BODY_COLOUR, 1).fillPoints(pts, true);
    g.lineStyle(3, 0x1b1b1b, 1).strokePoints(pts, true, true);
    genome.wheels.forEach((w, slot) => {
      if (w.vertex < 0) return;
      const p = pts[w.vertex];
      const r = w.radius * s;
      g.fillStyle(0x222222, 1).fillCircle(p.x, p.y, r);
      g.fillStyle(BODY_COLOUR, 1).fillCircle(p.x, p.y, Math.max(3, r * 0.4));
      if (slot === this.selected) g.lineStyle(4, 0xffd23f, 1).strokeCircle(p.x, p.y, r + 3);
    });
    for (const p of pts) {
      g.fillStyle(0xffffff, 1).fillCircle(p.x, p.y, 9);
      g.lineStyle(2, 0x1b1b1b, 1).strokeCircle(p.x, p.y, 9);
    }
    if (this.pendingMeasure) {
      measureOnNextFrame(this.pendingMeasure);
      this.pendingMeasure = null;
    }
  }
}

export function startWorkshop(parent: HTMLElement, cb: WorkshopCallbacks): WorkshopHandle {
  const scene = new WorkshopScene("taller");
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#16222f",
    render: { preserveDrawingBuffer: true },
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 360, height: parent.clientHeight || 400 },
    // La entrada la gestiona este módulo con eventos del DOM: así un arrastre que sale del lienzo sigue vivo.
    input: { mouse: false, touch: false },
    scene,
  });

  scene.pendingMeasure = "abrir-pista";
  let drag: { index: number; startX: number; startY: number; moved: boolean } | null = null;
  const local = (e: PointerEvent) => {
    const r = parent.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const apply = (genome: Genome, slot: number | null, event: string | null) => {
    scene.genome = genome;
    scene.selected = slot;
    scene.invalidate();
    if (event) scene.pendingMeasure = event;
    cb.onGenome(genome, slot);
  };

  const down = (e: PointerEvent) => {
    if (!scene.genome) return;
    const { px, py } = local(e);
    const index = scene.hit(px, py);
    if (index < 0) return;
    drag = { index, startX: px, startY: py, moved: false };
    parent.setPointerCapture(e.pointerId);
    markInput("arrastrar-vertice");
    cb.onGesture();
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!drag || !scene.genome) return;
    const { px, py } = local(e);
    if (!drag.moved && Math.hypot(px - drag.startX, py - drag.startY) < TAP_SLOP_PX) return;
    drag.moved = true;
    markInput("arrastrar-vertice");
    const m = scene.toMeters(px, py);
    apply(moveVertex(scene.genome, drag.index, m.x, m.y), scene.selected, "arrastrar-vertice");
  };
  const up = (e: PointerEvent) => {
    if (!drag) return;
    const tocado = !drag.moved;
    const index = drag.index;
    drag = null;
    if (parent.hasPointerCapture(e.pointerId)) parent.releasePointerCapture(e.pointerId);
    if (tocado && scene.genome) {
      markInput("poner-rueda");
      const r = toggleWheel(scene.genome, index);
      const slot = r.slot ?? (wheelAt(r.genome, index) >= 0 ? wheelAt(r.genome, index) : null);
      apply(r.genome, slot, "poner-rueda");
    }
  };
  const cancel = () => {
    drag = null;
  };
  parent.addEventListener("pointerdown", down);
  parent.addEventListener("pointermove", move);
  parent.addEventListener("pointerup", up);
  parent.addEventListener("pointercancel", cancel);

  return {
    setState(genome, selectedSlot) {
      scene.genome = genome;
      scene.selected = selectedSlot;
      scene.invalidate();
    },
    destroy() {
      parent.removeEventListener("pointerdown", down);
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerup", up);
      parent.removeEventListener("pointercancel", cancel);
      game.destroy(true);
    },
  };
}
