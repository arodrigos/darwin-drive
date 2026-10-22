import "../detmath";
import { Polygon, Vec2, type Body, type Fixture, type World } from "planck";
import { FRACCION_DESTROZADO, DISTANCIA_PIEZA, VIDA_PIEZA_PASOS } from "../rotura";
import { VERTEX_COUNT } from "../genome";
import { maxMotorTorque, type CarParts } from "./car";

const GROUP = -1;

interface PiezaSuelta {
  body: Body;
  /** Triángulo de origen, o −1 si es una rueda. */
  i: number;
  edad: number;
}

export interface Rotura {
  i: number;
  x: number;
  y: number;
}

/**
 * Rotura del coche: el mundo solo se toca justo después de `world.step`, nunca
 * dentro del solver, y los triángulos se rompen en orden de índice para que
 * el resultado no dependa del orden de los contactos.
 */
export class Fragilidad {
  private readonly impulso = new Float64Array(VERTEX_COUNT);
  private readonly indice = new Map<Fixture, number>();
  private readonly sueltas: PiezaSuelta[] = [];
  private mascara = (1 << VERTEX_COUNT) - 1;
  private perdidas = 0;
  private recientes: Rotura[] = [];

  constructor(
    private readonly world: World,
    private readonly car: CarParts,
  ) {
    car.tris.forEach((t, i) => this.indice.set(t.fixture!, i));
    // Solo se acumula: modificar el mundo aquí, en pleno solver, lo dejaría inconsistente.
    world.on("post-solve", (contact, imp) => {
      const a = this.indice.get(contact.getFixtureA());
      const b = this.indice.get(contact.getFixtureB());
      if (a === undefined && b === undefined) return;
      let suma = 0;
      for (let k = 0; k < imp.normalImpulses.length; k++) suma += imp.normalImpulses[k];
      if (a !== undefined) this.impulso[a] += suma;
      if (b !== undefined) this.impulso[b] += suma;
    });
  }

  get piezasPerdidas(): number {
    return this.perdidas;
  }

  /** Bit i a 1 mientras el triángulo i sigue montado. */
  get piezas(): number {
    return this.mascara;
  }

  get cuerpos(): number {
    return this.sueltas.length;
  }

  masaMontada(): number {
    let m = this.car.chassis.getMass();
    for (const w of this.car.wheels) if (!w.suelta) m += w.body.getMass();
    return m;
  }

  destrozado(): boolean {
    return this.masaMontada() < FRACCION_DESTROZADO * this.car.mass;
  }

  sueltasPose(): { i: number; x: number; y: number; angle: number }[] {
    return this.sueltas.filter((s) => s.i >= 0).map((s) => ({ i: s.i, x: s.body.getPosition().x, y: s.body.getPosition().y, angle: s.body.getAngle() }));
  }

  /** Roturas desde la última lectura: el destello de la pantalla. */
  tomarRoturas(): Rotura[] {
    const r = this.recientes;
    this.recientes = [];
    return r;
  }

  /** Llamar justo después de world.step. Devuelve cuántos triángulos se han roto en este paso. */
  aplicar(): number {
    let rotos = 0;
    const { chassis, tris } = this.car;
    for (let i = 0; i < VERTEX_COUNT; i++) {
      const imp = this.impulso[i];
      this.impulso[i] = 0;
      const t = tris[i];
      if (!t.fixture || imp / this.car.mass <= t.umbral) continue;
      this.romper(i, chassis);
      rotos++;
    }
    if (rotos > 0) this.reajustar();
    return rotos;
  }

  private romper(i: number, chassis: Body): void {
    const t = this.car.tris[i];
    const fixture = t.fixture!;
    const shape = fixture.getShape() as Polygon;
    const locales = shape.m_vertices.map((v) => Vec2(v.x, v.y));
    const centro = chassis.getWorldPoint(Vec2((locales[0].x + locales[1].x + locales[2].x) / 3, (locales[0].y + locales[1].y + locales[2].y) / 3));
    const v = chassis.getLinearVelocityFromWorldPoint(centro);
    const w = chassis.getAngularVelocity();
    const densidad = fixture.getDensity();
    chassis.destroyFixture(fixture);
    t.fixture = null;
    this.mascara &= ~(1 << i);
    this.perdidas++;
    this.recientes.push({ i, x: centro.x, y: centro.y });

    // La pieza conserva la pose y la velocidad del punto de la carrocería donde estaba: v + ω × r.
    const pieza = this.world.createBody({ type: "dynamic", position: chassis.getPosition(), angle: chassis.getAngle(), allowSleep: false });
    pieza.createFixture(new Polygon(locales), { density: densidad, friction: 0.3, filterGroupIndex: GROUP });
    pieza.setLinearVelocity(v);
    pieza.setAngularVelocity(w);
    this.sueltas.push({ body: pieza, i, edad: 0 });
  }

  /** Ruedas que pierden sus dos triángulos y par recalculado con la masa que queda. */
  private reajustar(): void {
    const { tris, wheels } = this.car;
    for (const rueda of wheels) {
      if (rueda.suelta) continue;
      const k = rueda.vertex;
      if (tris[k].fixture || tris[(k + VERTEX_COUNT - 1) % VERTEX_COUNT].fixture) continue;
      this.world.destroyJoint(rueda.joint!);
      rueda.joint = null;
      rueda.suelta = true;
      this.sueltas.push({ body: rueda.body, i: -1, edad: 0 });
    }
    const masa = this.masaMontada();
    // Repartir entre las motrices de origen (no entre las que quedan) hace que el par por kilo solo pueda bajar.
    for (const rueda of wheels) if (!rueda.suelta) rueda.joint!.setMaxMotorTorque(maxMotorTorque(masa, rueda.radius, this.car.motrices));
  }

  /** Quita las piezas viejas o muy atrás. Devuelve las ruedas que han desaparecido. */
  limpiar(xCoche: number): void {
    for (let n = this.sueltas.length - 1; n >= 0; n--) {
      const s = this.sueltas[n];
      s.edad++;
      if (s.edad < VIDA_PIEZA_PASOS && s.body.getPosition().x >= xCoche - DISTANCIA_PIEZA) continue;
      this.world.destroyBody(s.body);
      this.sueltas.splice(n, 1);
      if (s.i < 0) {
        const rueda = this.car.wheels.find((w) => w.body === s.body);
        if (rueda) rueda.fuera = true;
      }
    }
  }

  dispose(): void {
    for (const s of this.sueltas) this.world.destroyBody(s.body);
    this.sueltas.length = 0;
  }
}


