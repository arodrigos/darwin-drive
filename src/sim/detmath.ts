// Matemática trascendente en JS puro: solo +, -, *, / y comparaciones, que IEEE 754
// fija al bit. Math.sin/cos/log/atan2… dependen de la versión de V8 (Node 22 y el
// Chromium del preview difieren en el último bit en un 3-10 % de las entradas) y en
// un kilómetro de física ese bit se amplifica: la marca de un coche tiene que
// depender solo de genoma, pista y PHYSICS_VERSION, en cualquier motor.
// Exactitud ~1e-15; lo que importa aquí es que sea idéntica en todos lados.

const PIO2_1 = 1.5707963267341256;
const PIO2_2 = 6.077100506303966e-11;
const PIO2_3 = 2.0222662487111665e-21;
const TWO_OVER_PI = 0.6366197723675814;
const TWO_PI = 6.283185307179586;
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const SQRT2 = 1.4142135623730951;
const PI = 3.141592653589793;
const PI_2 = 1.5707963267948966;
const PI_4 = 0.7853981633974483;

const view = new DataView(new ArrayBuffer(8));

function sinKernel(r: number): number {
  const z = r * r;
  const p = -0.16666666666666632 + z * (0.00833333333332249 + z * (-0.0001984126982985795 + z * (2.7557313707070068e-6 + z * (-2.505076025340686e-8 + z * 1.58969099521155e-10))));
  return r + r * z * p;
}

function cosKernel(r: number): number {
  const z = r * r;
  const p = 0.0416666666666666 + z * (-0.001388888888887411 + z * (2.480158728947673e-5 + z * (-2.7557314351390663e-7 + z * (2.087572321298175e-9 + z * -1.1359647557788195e-11))));
  return 1 - 0.5 * z + z * z * p;
}

/** Devuelve el cuadrante (0-3) y el resto en [-π/4, π/4]. */
function reduce(x: number): [number, number] {
  let a = x;
  // Para argumentos enormes `%` es exacto en IEEE y basta para acotar n.
  if (Math.abs(a) > 1e5) a = a % TWO_PI;
  const n = Math.round(a * TWO_OVER_PI);
  const r = a - n * PIO2_1 - n * PIO2_2 - n * PIO2_3;
  return [((n % 4) + 4) % 4, r];
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [q, r] = reduce(x);
  return q === 0 ? sinKernel(r) : q === 1 ? cosKernel(r) : q === 2 ? -sinKernel(r) : -cosKernel(r);
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [q, r] = reduce(x);
  return q === 0 ? cosKernel(r) : q === 1 ? -sinKernel(r) : q === 2 ? -cosKernel(r) : sinKernel(r);
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

function atanSeries(t: number): number {
  const z = t * t;
  let acc = 0;
  for (let k = 27; k >= 0; k--) acc = 1 / (2 * k + 1) - z * acc;
  return t * acc;
}

export function atan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  let r: number;
  if (a > 1e16) r = PI_2;
  else if (a > 1) r = PI_2 - atan1(1 / a);
  else r = atan1(a);
  return x < 0 ? -r : r;
}

/** atan en [0, 1] con una reducción más para que la serie converja deprisa. */
function atan1(a: number): number {
  return a > 0.4142135623730951 ? PI_4 + atanSeries((a - 1) / (a + 1)) : atanSeries(a);
}

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) {
    if (y === 0) return Object.is(x, -0) ? (Object.is(y, -0) ? -PI : PI) : y;
    return y > 0 ? PI_2 : -PI_2;
  }
  if (y === 0) return x > 0 ? y : Object.is(y, -0) ? -PI : PI;
  if (!Number.isFinite(x) && !Number.isFinite(y)) {
    const base = x > 0 ? PI_4 : 3 * PI_4;
    return y > 0 ? base : -base;
  }
  const t = atan(y / x);
  if (x > 0) return t;
  return y >= 0 ? t + PI : t - PI;
}

function pow2(k: number): number {
  view.setUint32(0, (k + 1023) << 20);
  view.setUint32(4, 0);
  return view.getFloat64(0);
}

export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const k = Math.round(x / 0.6931471805599453);
  const r = x - k * LN2_HI - k * LN2_LO;
  let acc = 1;
  for (let i = 18; i >= 1; i--) acc = 1 + (r * acc) / i;
  const k1 = Math.trunc(k / 2);
  return acc * pow2(k1) * pow2(k - k1);
}

export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let m = x;
  let e = 0;
  // Los subnormales se escalan 2^54 para poder leer el exponente.
  if (m < 2.2250738585072014e-308) {
    m *= 18014398509481984;
    e -= 54;
  }
  view.setFloat64(0, m);
  const exponent = ((view.getUint32(0) >>> 20) & 0x7ff) - 1023;
  view.setUint32(0, (view.getUint32(0) & 0x000fffff) | 0x3ff00000);
  m = view.getFloat64(0);
  e += exponent;
  if (m > SQRT2) {
    m /= 2;
    e += 1;
  }
  const s = (m - 1) / (m + 1);
  const z = s * s;
  let acc = 0;
  for (let k = 17; k >= 0; k--) acc = 1 / (2 * k + 1) + z * acc;
  return e * LN2_HI + (2 * s * acc + e * LN2_LO);
}

/** Se instala una sola vez y antes de que Planck capture `Math.sin` al cargarse. */
export function installDetMath(): void {
  const m = Math as unknown as Record<string, unknown>;
  if (m.__detmath === true) return;
  m.sin = sin;
  m.cos = cos;
  m.tan = tan;
  m.atan = atan;
  m.atan2 = atan2;
  m.exp = exp;
  m.log = log;
  m.__detmath = true;
}

installDetMath();
