// Cámara vertical de la carrera. Módulo puro (sin Phaser ni DOM): la escena le pasa
// el tiempo real entre fotogramas y él decide dónde queda el coche, de modo que el
// seguimiento sea el mismo a 60 fps que a 3.

/** Constantes de tiempo equivalentes al 0,1 y al 0,5 por fotograma que había a 60 fps. */
export const TAU_SEGUIR_MS = 158;
export const TAU_PARADO_MS = 24;
export const ANCLA_CARRERA = 0.6;
export const ANCLA_PARADA = 0.4;

// Márgenes de la banda: dejan libres el contador y su rótulo de tramo (arriba, 132 px
// en móvil) y la fila de ritmos (abajo). Con la carrera parada el límite de abajo sube
// a la mitad porque la tarjeta de fin ocupa la mitad inferior.
const MARGEN_ARRIBA_FRAC = 0.2;
const MARGEN_ARRIBA_MIN_PX = 132;
const MARGEN_ABAJO_FRAC = 0.18;
const MARGEN_ABAJO_MIN_PX = 96;
const ABAJO_PARADO_FRAC = 0.5;

export interface Banda {
  arribaPx: number;
  abajoPx: number;
}
export interface EstadoCamara {
  refH: number;
  ancla: number;
}
export interface EntradaCamara {
  dtMs: number;
  liderY: number;
  sobreM: number;
  bajoM: number;
  altoPx: number;
  pxPorMetro: number;
  parado: boolean;
}

/** Exponencial por tiempo: partir el intervalo en cualquier número de pasos da el mismo resultado. */
export function amortiguar(actual: number, objetivo: number, tauMs: number, dtMs: number): number {
  const dt = Number.isNaN(dtMs) ? 0 : Math.max(0, dtMs);
  if (dt === 0) return actual;
  return objetivo + (actual - objetivo) * Math.exp(-dt / tauMs);
}

export function bandaSegura(altoPx: number, parado: boolean): Banda {
  const arribaPx = Math.max(altoPx * MARGEN_ARRIBA_FRAC, MARGEN_ARRIBA_MIN_PX);
  const abajoLibre = altoPx - Math.max(altoPx * MARGEN_ABAJO_FRAC, MARGEN_ABAJO_MIN_PX);
  const abajoPx = parado ? Math.min(abajoLibre, altoPx * ABAJO_PARADO_FRAC) : abajoLibre;
  // Pantallas diminutas: la banda no puede invertirse.
  return abajoPx > arribaPx ? { arribaPx, abajoPx } : { arribaPx: altoPx / 2 - 1, abajoPx: altoPx / 2 + 1 };
}

export function pasoCamara(previo: EstadoCamara | null, e: EntradaCamara): EstadoCamara & { banda: Banda; recortada: boolean } {
  const banda = bandaSegura(e.altoPx, e.parado);
  const objetivoAncla = e.parado ? ANCLA_PARADA : ANCLA_CARRERA;
  const tau = e.parado ? TAU_PARADO_MS : TAU_SEGUIR_MS;
  const previoValido = previo !== null && Number.isFinite(previo.refH) && Number.isFinite(previo.ancla);
  // dt infinito equivale a «encuadra de golpe»: la exponencial ya tiende a 0, pero se evita el NaN de inf·0.
  const dtMs = Number.isFinite(e.dtMs) ? e.dtMs : e.dtMs > 0 ? 1e9 : 0;
  let ancla = previoValido ? amortiguar(previo.ancla, objetivoAncla, tau, dtMs) : objetivoAncla;
  let refH = previoValido ? amortiguar(previo.refH, e.liderY, tau, dtMs) : e.liderY;

  const alto = (e.sobreM + e.bajoM) * e.pxPorMetro;
  const anchoBanda = banda.abajoPx - banda.arribaPx;
  const arriba = () => e.altoPx * ancla - (e.liderY + e.sobreM - refH) * e.pxPorMetro;
  let recortada = false;
  if (alto > anchoBanda) {
    // No cabe: se centra la caja en la banda.
    const centro = arriba() + alto / 2;
    refH += ((banda.arribaPx + banda.abajoPx) / 2 - centro) / e.pxPorMetro;
    recortada = true;
  } else {
    const top = arriba();
    if (top < banda.arribaPx) {
      refH += (banda.arribaPx - top) / e.pxPorMetro;
      recortada = true;
    } else if (top + alto > banda.abajoPx) {
      refH -= (top + alto - banda.abajoPx) / e.pxPorMetro;
      recortada = true;
    }
  }
  if (!Number.isFinite(ancla)) ancla = objetivoAncla;
  return { refH, ancla, banda, recortada };
}
