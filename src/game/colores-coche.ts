/** Paleta Okabe-Ito (distinguible con daltonismo) más un blanco hueso: el color de un coche es un metadato, nunca parte del genoma. */
export type ColorCoche = "naranja" | "cielo" | "verde" | "amarillo" | "azul" | "bermellon" | "purpura" | "hueso";

export const PALETA_COCHES: Record<ColorCoche, { hex: string; nombre: string }> = {
  naranja: { hex: "#E69F00", nombre: "Naranja" },
  cielo: { hex: "#56B4E9", nombre: "Azul cielo" },
  verde: { hex: "#009E73", nombre: "Verde" },
  amarillo: { hex: "#F0E442", nombre: "Amarillo" },
  azul: { hex: "#0072B2", nombre: "Azul" },
  bermellon: { hex: "#D55E00", nombre: "Bermellón" },
  purpura: { hex: "#CC79A7", nombre: "Púrpura" },
  hueso: { hex: "#F2EFE6", nombre: "Hueso" },
};

export const COLOR_PREDETERMINADO: ColorCoche = "naranja";

/** Orden fijo en el selector: el mismo de la paleta. */
export const COLORES_COCHE = Object.keys(PALETA_COCHES) as ColorCoche[];

export interface IdentidadCoche {
  nombre: string;
  color: ColorCoche;
}

export function esColorCoche(v: unknown): v is ColorCoche {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PALETA_COCHES, v);
}

/** El número 0xRRGGBB que pide Phaser. */
export function colorNumerico(c: ColorCoche): number {
  return parseInt(PALETA_COCHES[c].hex.slice(1), 16);
}

/** El color de la paleta más cercano a un #rrggbb (el código compartido lleva el hex; el garaje guarda el nombre de la paleta). */
export function colorMasCercano(hex: string): ColorCoche {
  const canales = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = canales(hex);
  let mejor: ColorCoche = COLOR_PREDETERMINADO;
  let mejorD = Infinity;
  for (const c of COLORES_COCHE) {
    const [pr, pg, pb] = canales(PALETA_COCHES[c].hex);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < mejorD) {
      mejor = c;
      mejorD = d;
    }
  }
  return mejor;
}
