import Phaser from "phaser";
import { runtime } from "@/debug/ganchos";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { GENE_RANGES, VERTEX_COUNT, type Genome } from "@/sim/genome";
import { gestionarLienzo, type OpcionesGestor } from "./lienzo";
import { opacidadBase } from "./opacidad";
import { colorNumerico, COLOR_PREDETERMINADO, type ColorCoche } from "./colores-coche";
import { ejeDeInclinacion, inclinacionDeEje, moveVertex, setWheelAxis, wheelAt } from "./editor";
import { estatica } from "@/sim/physics/estatica";

const HANDLE_DIAMETER = 44;
// Por debajo de este recorrido un gesto es un toque (elegir el punto), no un arrastre.
const TAP_SLOP_PX = 8;
const SKY = 0x16222f;
// Mitad del recorrido de la guía de suspensión, en metros: el mismo ±0,6 m que se dibuja en el diseño.
const GUIA_M = 0.6;
const ROSA = 0xff5d73; // peso
const MENTA = 0x6df0c2; // par
// Par que llena el arco entero: el del coche de serie con unas ruedas grandes; por encima se queda en el tope.
const PAR_ARCO_COMPLETO = 600;
const ETIQUETA = { fontFamily: "system-ui, sans-serif", fontSize: "13px", fontStyle: "bold", stroke: "#0c0c0c", strokeThickness: 3 } as const;

export interface Encuadre {
  /** Píxeles por metro y píxel del origen del genoma (0,0). */
  s: number;
  ox: number;
  oy: number;
}

const MARGEN_PX = 16;
// El tirador de la guía sobresale 22 px de su centro.
const TIRADOR_PX = HANDLE_DIAMETER / 2;

/** Caja (m) de todo lo que se dibuja: cuerpo, ruedas, guías, cuña del punto elegido y, con fuerzas, la flecha de peso. */
function cajaMetros(genome: Genome, selected: number | null): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r);
    x1 = Math.max(x1, x + r);
    y0 = Math.min(y0, y - r);
    y1 = Math.max(y1, y + r);
  };
  const pos = (i: number) => ({ x: Math.cos(genome.body[i].angle) * genome.body[i].length, y: Math.sin(genome.body[i].angle) * genome.body[i].length });
  genome.body.forEach((_, i) => {
    const p = pos(i);
    add(p.x, p.y);
  });
  genome.wheels.forEach((w) => {
    if (w.vertex < 0) return;
    const p = pos(w.vertex);
    // Rueda y guía de ±0,6 m: se cubren con el mayor de los dos radios.
    add(p.x, p.y, Math.max(w.radius, GUIA_M));
  });
  if (selected !== null) {
    const [lo, hi] = GENE_RANGES.angle(selected);
    const [minL, maxL] = GENE_RANGES.length;
    for (let k = 0; k <= 12; k++) {
      const a = lo + ((hi - lo) * k) / 12;
      add(Math.cos(a) * maxL, Math.sin(a) * maxL);
      add(Math.cos(a) * minL, Math.sin(a) * minL);
    }
  }
  return { x0, x1, y0, y1 };
}

/** Escala y origen que meten la caja del coche en la zona útil (el lienzo menos la cabecera) con margen. */
export function calcularEncuadre(genome: Genome, selected: number | null, fuerzas: boolean, w: number, h: number, cabecera: number): Encuadre {
  const c = cajaMetros(genome, selected);
  // Con fuerzas se reserva sitio abajo para la flecha de peso (hasta 1,6·s + 9 px) y la etiqueta, y a los lados para los arcos de par.
  const extraAbajo = fuerzas ? 60 : 0;
  const extraLado = fuerzas ? 14 : 0;
  const m = MARGEN_PX + TIRADOR_PX * (selected !== null ? 0.5 : 0);
  const util = { l: m + extraLado, r: w - m - extraLado, t: Math.min(cabecera, h * 0.5) + m, b: h - m - extraAbajo };
  const ancho = Math.max(1, util.r - util.l);
  const alto = Math.max(1, util.b - util.t);
  const s = Math.max(8, Math.min(ancho / Math.max(0.5, c.x1 - c.x0), alto / Math.max(0.5, c.y1 - c.y0), w / 5));
  const cx = (c.x0 + c.x1) / 2;
  const cy = (c.y0 + c.y1) / 2;
  return { s, ox: (util.l + util.r) / 2 - cx * s, oy: (util.t + util.b) / 2 + cy * s };
}

export interface WorkshopHandle {
  /** El genoma, el punto elegido y el color que debe pintar. */
  setState(genome: Genome, selectedVertex: number | null, color?: ColorCoche, fuerzas?: boolean): void;
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
  fuerzas = false;
  private etiquetas: Phaser.GameObjects.Text[] = [];
  private g!: Phaser.GameObjects.Graphics;
  private dirty = true;
  pendingMeasure: string | null = null;

  create(): void {
    this.cameras.main.setBackgroundColor(SKY);
    this.g = this.add.graphics();
    // Peso + un «par» por rueda (máx. 4): se crean una vez y se colocan o esconden en cada dibujo.
    this.etiquetas = [0, 1, 2, 3, 4].map((i) =>
      this.add.text(0, 0, i === 0 ? "peso" : "par", { ...ETIQUETA, color: i === 0 ? "#ff5d73" : "#6df0c2" }).setVisible(false).setDepth(5),
    );
    this.scale.on("resize", () => this.invalidate());
  }

  invalidate(): void {
    this.dirty = true;
    this.encSucio = true;
  }

  /** Transform metros → píxeles. Se recalcula perezosamente para que hit/toMeters nunca usen uno viejo; congelado durante un arrastre. */
  private enc: Encuadre = { s: 50, ox: 180, oy: 150 };
  private encSucio = true;
  congelado = false;
  /** Alto en px de lo que la cabecera tapa por arriba del lienzo (lo mide startWorkshop). */
  cabeceraPx = 0;

  get encuadre(): Encuadre {
    if (this.encSucio && !this.congelado && this.genome) {
      this.enc = calcularEncuadre(this.genome, this.selected, this.fuerzas, this.scale.width, this.scale.height, this.cabeceraPx);
      this.encSucio = false;
    }
    return this.enc;
  }

  get scale_(): number {
    return this.encuadre.s;
  }

  toScreen(x: number, y: number): { px: number; py: number } {
    const e = this.encuadre;
    return { px: e.ox + x * e.s, py: e.oy - y * e.s };
  }

  toMeters(px: number, py: number): { x: number; y: number } {
    const e = this.encuadre;
    return { x: (px - e.ox) / e.s, y: -(py - e.oy) / e.s };
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


  /** Extremo de la guía de la rueda de ese vértice por el que se agarra: el de arriba, para que el dedo no tape el coche. */
  extremoGuia(genome: Genome, vertex: number): { px: number; py: number } | null {
    const w = genome.wheels.find((q) => q.vertex === vertex);
    if (!w) return null;
    const c = this.vertexScreen(genome, vertex);
    const s = this.scale_ * GUIA_M;
    const sentido = Math.sin(w.axisAngle) >= 0 ? 1 : -1;
    return { px: c.px + Math.cos(w.axisAngle) * s * sentido, py: c.py - Math.sin(w.axisAngle) * s * sentido };
  }

  /** Línea de la guía con topes en los extremos y un muelle en zigzag entre ellos; la de la rueda elegida va resaltada y con tirador. */
  private dibujarGuia(genome: Genome, vertex: number, axisAngle: number, elegida: boolean): void {
    const g = this.g;
    const c = this.vertexScreen(genome, vertex);
    const len = this.scale_ * GUIA_M;
    const dx = Math.cos(axisAngle);
    const dy = -Math.sin(axisAngle);
    const nx = -dy;
    const ny = dx;
    const color = elegida ? 0xffd23f : 0xffffff;
    const alpha = elegida ? 1 : 0.55;
    const ancho = elegida ? 4 : 2;
    const a = { x: c.px - dx * len, y: c.py - dy * len };
    const b = { x: c.px + dx * len, y: c.py + dy * len };
    // La elegida lleva un halo oscuro ancho: sobre la rueda (también oscura) el amarillo solo no bastaba para distinguirla.
    g.lineStyle(elegida ? 10 : ancho, 0x0c0c0c, elegida ? 0.9 : alpha).lineBetween(a.x, a.y, b.x, b.y);
    g.lineStyle(elegida ? 5 : ancho - 1, color, alpha);
    const DIENTES = 7;
    const amp = elegida ? 10 : 6;
    const zig: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(a.x, a.y)];
    for (let k = 1; k < DIENTES * 2; k++) {
      const t = k / (DIENTES * 2);
      const lado = k % 2 === 0 ? -1 : 1;
      zig.push(new Phaser.Math.Vector2(a.x + (b.x - a.x) * t + nx * amp * lado, a.y + (b.y - a.y) * t + ny * amp * lado));
    }
    zig.push(new Phaser.Math.Vector2(b.x, b.y));
    g.strokePoints(zig, false, false);
    // Topes: la rueda no pasa de ahí.
    for (const e of [a, b]) g.lineBetween(e.x - nx * 10, e.y - ny * 10, e.x + nx * 10, e.y + ny * 10);
    if (elegida) {
      const t = this.extremoGuia(genome, vertex)!;
      g.fillStyle(0x0c0c0c, 0.55).fillCircle(t.px, t.py, HANDLE_DIAMETER / 2);
      g.lineStyle(5, 0x0c0c0c, 1).strokeCircle(t.px, t.py, HANDLE_DIAMETER / 2);
      g.lineStyle(3, 0xffd23f, 1).strokeCircle(t.px, t.py, HANDLE_DIAMETER / 2);
      g.fillStyle(0xffd23f, 1).fillCircle(t.px, t.py, 8);
    }
  }

  private flecha(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const g = this.g;
    g.lineStyle(4, color, 1).lineBetween(x1, y1, x2, y2);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const p = (da: number) => ({ x: x2 - Math.cos(ang + da) * 12, y: y2 - Math.sin(ang + da) * 12 });
    const l = p(0.45);
    const r = p(-0.45);
    g.fillStyle(color, 1).fillTriangle(x2, y2, l.x, l.y, r.x, r.y);
  }

  /** Centro de masas, flecha de peso y arco de par de cada rueda: lo que calcula estatica.ts, el mismo cálculo que la física. */
  private dibujarFuerzas(genome: Genome): void {
    const g = this.g;
    const e = estatica(genome);
    const s = this.scale_;
    const cm = this.toScreen(e.centroMasas.x, e.centroMasas.y);
    const peso = this.etiquetas[0];
    // El largo de la flecha crece con la masa; el máximo cabe en cualquier lienzo.
    const largo = Math.max(28, Math.min(s * 1.6, 18 + e.masa * 0.35));
    this.flecha(cm.px, cm.py + 9, cm.px, cm.py + 9 + largo, ROSA);
    peso.setPosition(cm.px + 10, cm.py + 9 + largo - 8).setVisible(true);
    g.fillStyle(0xffffff, 1).fillCircle(cm.px, cm.py, 9);
    g.fillStyle(0x0c0c0c, 1).slice(cm.px, cm.py, 9, 0, Math.PI / 2, false).fillPath();
    g.fillStyle(0x0c0c0c, 1).slice(cm.px, cm.py, 9, Math.PI, (3 * Math.PI) / 2, false).fillPath();
    g.lineStyle(2, 0x0c0c0c, 1).strokeCircle(cm.px, cm.py, 9);
    e.ruedas.forEach((r, n) => {
      const c = this.vertexScreen(genome, r.vertex);
      const radio = genome.wheels[r.slot].radius * s + 12;
      // En pantalla el eje y baja: un ángulo que crece gira en el sentido del reloj, que es hacia donde ruedan las ruedas al avanzar.
      const inicio = -Math.PI * 0.9;
      const barrido = Math.max(0.5, Math.min(1.7 * Math.PI, (r.parMax / PAR_ARCO_COMPLETO) * 1.7 * Math.PI));
      g.lineStyle(5, MENTA, 1).beginPath().arc(c.px, c.py, radio, inicio, inicio + barrido, false).strokePath();
      const fin = inicio + barrido;
      const px = c.px + Math.cos(fin) * radio;
      const py = c.py + Math.sin(fin) * radio;
      const tx = -Math.sin(fin);
      const ty = Math.cos(fin);
      g.fillStyle(MENTA, 1).fillTriangle(px + tx * 12, py + ty * 12, px - ty * 8, py + tx * 8, px + ty * 8, py - tx * 8);
      this.etiquetas[n + 1].setPosition(c.px + Math.cos(inicio) * radio - 28, c.py + Math.sin(inicio) * radio - 18).setVisible(true);
    });
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
    for (const t of this.etiquetas) t.setVisible(false);
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
    // Las guías van sobre el coche y bajo los puntos, para que las asas sigan siendo lo primero que se alcanza.
    const elegidaRueda = this.selected !== null ? wheelAt(genome, this.selected) : -1;
    genome.wheels.forEach((w, slot) => {
      if (w.vertex >= 0) this.dibujarGuia(genome, w.vertex, w.axisAngle, slot === elegidaRueda);
    });
    if (this.fuerzas) this.dibujarFuerzas(genome);
    pts.forEach((p, i) => {
      g.fillStyle(0xffffff, 1).fillCircle(p.x, p.y, 9);
      g.lineStyle(2, 0x1b1b1b, 1).strokeCircle(p.x, p.y, 9);
      // Anillo amarillo grueso: el punto elegido se distingue sin depender del color del coche.
      if (i === this.selected) g.lineStyle(4, 0xffd23f, 1).strokeCircle(p.x, p.y, 15);
    });
    this.publicarEncuadre(genome);
    if (this.pendingMeasure) {
      measureOnNextFrame(this.pendingMeasure);
      this.pendingMeasure = null;
    }
  }

  /** Gancho de pruebas: el transform y la caja en px de todo lo dibujado, para tocar vértices sin suponer una escala. */
  private publicarEncuadre(genome: Genome): void {
    const c = cajaMetros(genome, this.selected);
    const a = this.toScreen(c.x0, c.y1);
    const b = this.toScreen(c.x1, c.y0);
    let bottom = b.py;
    if (this.fuerzas) {
      const e = estatica(genome);
      const cm = this.toScreen(e.centroMasas.x, e.centroMasas.y);
      bottom = Math.max(bottom, cm.py + 9 + Math.max(28, Math.min(this.scale_ * 1.6, 18 + e.masa * 0.35)));
    }
    const enc = this.encuadre;
    runtime.tallerEncuadre = {
      escalaPxM: enc.s,
      origenPx: { x: enc.ox, y: enc.oy },
      zonaUtil: { top: this.cabeceraPx, bottom: this.scale.height, left: 0, right: this.scale.width },
      cajaCochePx: { top: a.py, bottom, left: a.px, right: b.px },
    };
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
        scene.fuerzas = vieja.fuerzas;
        scene.cabeceraPx = vieja.cabeceraPx;
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
  // La cabecera va encima del lienzo: el coche se encuadra por debajo de ella.
  const medirCabecera = () => {
    const cab = parent.closest(".taller")?.querySelector(".cabecera");
    scene.cabeceraPx = cab ? Math.max(0, cab.getBoundingClientRect().bottom - parent.getBoundingClientRect().top) : 0;
  };
  // En modo RESIZE scale.resize() se deshace solo (updateScale relee parentSize, aún viejo): hay que mandar el tamaño del padre con setParentSize.
  const observer = new ResizeObserver(() => {
    if (parent.clientWidth > 0 && parent.clientHeight > 0) gestor.juego()?.scale.setParentSize(parent.clientWidth, parent.clientHeight);
    medirCabecera();
    scene.invalidate();
  });
  observer.observe(parent);
  scene.pendingMeasure = "abrir-pista";
  let drag: { index: number; startX: number; startY: number; moved: boolean } | null = null;
  // Arrastre del tirador de la guía de suspensión de la rueda elegida.
  let tirador: { vertex: number; slot: number } | null = null;
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
    // El tirador se prueba antes que los puntos: su extremo puede caer cerca de uno y el jugador lo ha elegido a propósito.
    if (scene.selected !== null) {
      const slot = wheelAt(scene.genome, scene.selected);
      const t = slot >= 0 ? scene.extremoGuia(scene.genome, scene.selected) : null;
      if (t && Math.hypot(t.px - px, t.py - py) <= HANDLE_DIAMETER / 2) {
        tirador = { vertex: scene.selected, slot };
        scene.congelado = true;
        parent.setPointerCapture(e.pointerId);
        cb.onGesture();
        e.preventDefault();
        return;
      }
    }
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
    // Con el encuadre quieto durante el gesto, el punto no se escapa del dedo.
    scene.congelado = true;
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
    if (tirador && scene.genome) {
      const { px, py } = local(e);
      const c = scene.vertexScreen(scene.genome, tirador.vertex);
      const dx = px - c.px;
      const dy = -(py - c.py);
      if (Math.hypot(dx, dy) < 4) return;
      markInput("inclinar-suspension");
      // La guía es una recta: el ángulo del dedo respecto al centro de la rueda vale en cualquiera de sus dos mitades.
      const grados = inclinacionDeEje(Math.atan2(dy, dx));
      apply(setWheelAxis(scene.genome, tirador.slot, ejeDeInclinacion(Math.round(grados))), "inclinar-suspension");
      return;
    }
    if (!drag || !scene.genome) return;
    const { px, py } = local(e);
    if (!drag.moved && Math.hypot(px - drag.startX, py - drag.startY) < TAP_SLOP_PX) return;
    drag.moved = true;
    markInput("arrastrar-vertice");
    const m = scene.toMeters(px, py);
    apply(moveVertex(scene.genome, drag.index, m.x, m.y), "arrastrar-vertice");
  };
  const up = (e: PointerEvent) => {
    if (!drag && !tirador) return;
    drag = null;
    tirador = null;
    scene.congelado = false;
    scene.invalidate();
    if (parent.hasPointerCapture(e.pointerId)) parent.releasePointerCapture(e.pointerId);
  };
  const cancel = () => {
    drag = null;
    tirador = null;
    scene.congelado = false;
    scene.invalidate();
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
    setState(genome, selectedVertex, color = COLOR_PREDETERMINADO, fuerzas = false) {
      if (scene.fuerzas !== fuerzas) scene.pendingMeasure = "ver-fuerzas";
      scene.fuerzas = fuerzas;
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
      runtime.tallerEncuadre = null;
      gestor.destruir();
    },
  };
}
