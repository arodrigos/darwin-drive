import Phaser from "phaser";
import { runtime } from "@/debug/ganchos";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { GENE_RANGES, VERTEX_COUNT, type Genome } from "@/sim/genome";
import { gestionarLienzo, type OpcionesGestor } from "./lienzo";
import { opacidadBase } from "./opacidad";
import { colorNumerico, COLOR_PREDETERMINADO, type ColorCoche } from "./colores-coche";
import { moveVertex } from "./editor";

const HANDLE_DIAMETER = 44;
// Por debajo de este recorrido un gesto es un toque (elegir el punto), no un arrastre.
const TAP_SLOP_PX = 8;
const SKY = 0x16222f;

export interface WorkshopHandle {
  /** El genoma, el punto elegido y el color que debe pintar. */
  setState(genome: Genome, selectedVertex: number | null, color?: ColorCoche): void;
  /** Marca una acción de los controles del panel para medir su latencia hasta el siguiente frame pintado. */
  medir(evento: string): void;
  destroy(): void;
}

export interface WorkshopCallbacks {
  /** Siempre un genoma normalizado: el editor no emite otra cosa. */
  onGenome(genome: Genome): void;
  /** Tocar o empezar a arrastrar un punto lo elige; tocar el vacío lo suelta. */
  onSelect(vertex: number | null): void;
  /** Primer gesto del jugador (cierra la ayuda inicial). */
  onGesture(): void;
}

class WorkshopScene extends Phaser.Scene {
  genome: Genome | null = null;
  selected: number | null = null; // vértice elegido
  color: ColorCoche = COLOR_PREDETERMINADO;
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

  /** Cuña translúcida con el sector donde puede moverse el punto: de la longitud mínima a la máxima. */
  private dibujarCuna(i: number): void {
    const [lo, hi] = GENE_RANGES.angle(i);
    const [minL, maxL] = GENE_RANGES.length;
    const PASOS = 12;
    const pts: Phaser.Math.Vector2[] = [];
    for (let k = 0; k <= PASOS; k++) {
      const a = lo + ((hi - lo) * k) / PASOS;
      const p = this.toScreen(Math.cos(a) * maxL, Math.sin(a) * maxL);
      pts.push(new Phaser.Math.Vector2(p.px, p.py));
    }
    for (let k = PASOS; k >= 0; k--) {
      const a = lo + ((hi - lo) * k) / PASOS;
      const p = this.toScreen(Math.cos(a) * minL, Math.sin(a) * minL);
      pts.push(new Phaser.Math.Vector2(p.px, p.py));
    }
    this.g.fillStyle(0xffd23f, 0.2).fillPoints(pts, true);
    this.g.lineStyle(1.5, 0xffd23f, 0.7).strokePoints(pts, true, true);
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
    // Solo el relleno cambia con el peso; el contorno siempre opaco para que la forma se lea.
    const base = opacidadBase(genome.bodyDensity);
    runtime.opacidades = Array.from({ length: VERTEX_COUNT }, () => base);
    const colorCuerpo = colorNumerico(this.color);
    if (this.selected !== null) this.dibujarCuna(this.selected);
    g.fillStyle(colorCuerpo, base).fillPoints(pts, true);
    // Contorno oscuro de 3 px y trazo interior de 2 px del color, opacos: el color se lee aunque el relleno sea translúcido.
    g.lineStyle(3, 0x0c0c0c, 1).strokePoints(pts, true, true);
    const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
    const cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    g.lineStyle(2, colorCuerpo, 1).strokePoints(
      pts.map((q) => {
        const d = Math.hypot(q.x - cx, q.y - cy) || 1;
        const k = Math.max(0, d - 3) / d;
        return new Phaser.Math.Vector2(cx + (q.x - cx) * k, cy + (q.y - cy) * k);
      }),
      true,
      true,
    );
    genome.wheels.forEach((w) => {
      if (w.vertex < 0) return;
      const p = pts[w.vertex];
      const r = w.radius * s;
      g.fillStyle(0x222222, 1).fillCircle(p.x, p.y, r);
      g.fillStyle(colorCuerpo, 1).fillCircle(p.x, p.y, Math.max(3, r * 0.4));
      if (w.vertex === this.selected) g.lineStyle(4, 0xffd23f, 1).strokeCircle(p.x, p.y, r + 3);
    });
    pts.forEach((p, i) => {
      g.fillStyle(0xffffff, 1).fillCircle(p.x, p.y, 9);
      g.lineStyle(2, 0x1b1b1b, 1).strokeCircle(p.x, p.y, 9);
      // Anillo amarillo grueso: el punto elegido se distingue sin depender del color del coche.
      if (i === this.selected) g.lineStyle(4, 0xffd23f, 1).strokeCircle(p.x, p.y, 15);
    });
    if (this.pendingMeasure) {
      measureOnNextFrame(this.pendingMeasure);
      this.pendingMeasure = null;
    }
  }
}

export function startWorkshop(parent: HTMLElement, cb: WorkshopCallbacks, opciones: OpcionesGestor = {}): WorkshopHandle {
  let scene = new WorkshopScene("taller");
  const gestor = gestionarLienzo(
    parent,
    (reconstruccion) => {
      if (reconstruccion) {
        const vieja = scene;
        scene = new WorkshopScene("taller");
        scene.genome = vieja.genome;
        scene.selected = vieja.selected;
        scene.color = vieja.color;
      }
      return new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        backgroundColor: "#16222f",
        render: { preserveDrawingBuffer: true },
        scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 360, height: parent.clientHeight || 400 },
        // La entrada la gestiona este módulo con eventos del DOM: así un arrastre que sale del lienzo sigue vivo.
        input: { mouse: false, touch: false },
        scene,
      });
    },
    opciones,
  );

  // Phaser solo reacciona al redimensionado de la ventana; el panel del Taller cambia de alto sin que la ventana se mueva.
  const observer = new ResizeObserver(() => {
    if (parent.clientWidth > 0 && parent.clientHeight > 0) gestor.juego()?.scale.resize(parent.clientWidth, parent.clientHeight);
  });
  observer.observe(parent);
  scene.pendingMeasure = "abrir-pista";
  let drag: { index: number; startX: number; startY: number; moved: boolean } | null = null;
  const local = (e: PointerEvent) => {
    const r = parent.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const apply = (genome: Genome, event: string) => {
    scene.genome = genome;
    scene.invalidate();
    scene.pendingMeasure = event;
    cb.onGenome(genome);
  };

  const down = (e: PointerEvent) => {
    if (!scene.genome) return;
    const { px, py } = local(e);
    const index = scene.hit(px, py);
    if (index < 0) {
      if (scene.selected !== null) {
        scene.selected = null;
        scene.invalidate();
        cb.onSelect(null);
      }
      return;
    }
    drag = { index, startX: px, startY: py, moved: false };
    parent.setPointerCapture(e.pointerId);
    // Elegir el punto es inmediato (también al empezar a arrastrar): la cuña se ve mientras dura el gesto.
    markInput("seleccionar-vertice");
    scene.selected = index;
    scene.pendingMeasure = "seleccionar-vertice";
    scene.invalidate();
    cb.onSelect(index);
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
    apply(moveVertex(scene.genome, drag.index, m.x, m.y), "arrastrar-vertice");
  };
  const up = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    if (parent.hasPointerCapture(e.pointerId)) parent.releasePointerCapture(e.pointerId);
  };
  const cancel = () => {
    drag = null;
  };
  parent.addEventListener("pointerdown", down);
  parent.addEventListener("pointermove", move);
  parent.addEventListener("pointerup", up);
  parent.addEventListener("pointercancel", cancel);

  return {
    medir(evento) {
      scene.pendingMeasure = evento;
      scene.invalidate();
    },
    setState(genome, selectedVertex, color = COLOR_PREDETERMINADO) {
      if (scene.genome && scene.genome.bodyDensity !== genome.bodyDensity) scene.pendingMeasure = "peso";
      if (scene.color !== color) scene.pendingMeasure = "color-coche";
      scene.color = color;
      scene.genome = genome;
      scene.selected = selectedVertex;
      scene.invalidate();
    },
    destroy() {
      parent.removeEventListener("pointerdown", down);
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerup", up);
      parent.removeEventListener("pointercancel", cancel);
      observer.disconnect();
      gestor.destruir();
    },
  };
}
