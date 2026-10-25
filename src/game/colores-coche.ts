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
