import { TIPOS_TRAMO, tipoTramo, type TipoSuperficie, type TipoTramo } from "@/sim/tracks";

export type PatronSuperficie = "ninguno" | "brillos" | "zigzag";

export interface AspectoSuperficie {
  /** Franja que se pinta sobre el borde del suelo; null en roca, que conserva el color de la pista. */
  color: number | null;
  /** Borde oscuro: separa la franja del cielo, donde el color solo no llega a 3:1. */
  contorno: number;
  /** El color no basta (daltonismo, pantallas apagadas): cada superficie lleva además un dibujo propio. */
  patron: PatronSuperficie;
}

export const ASPECTO: Record<TipoSuperficie, AspectoSuperficie> = {
  roca: { color: null, contorno: 0x000000, patron: "ninguno" },
  hielo: { color: 0xeaf8ff, contorno: 0x0b2540, patron: "brillos" },
  elastico: { color: 0xffe14d, contorno: 0x2a0f3d, patron: "zigzag" },
};

function canal(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminancia(rgb: number): number {
  return 0.2126 * canal((rgb >> 16) & 255) + 0.7152 * canal((rgb >> 8) & 255) + 0.0722 * canal(rgb & 255);
}

/** Relación de contraste WCAG entre dos colores 0xRRGGBB. */
export function contraste(a: number, b: number): number {
  const [hi, lo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const NOMBRE_TRAMO: Record<TipoTramo, string> = {
  llano: "Tramo llano",
  loma: "Loma",
  ondas: "Ondas",
  piedras: "Piedras",
  hielo: "Hielo",
  elastico: "Suelo elástico",
};

/** Rótulo del tramo de 25 m en el que está el coche (solo El Mosaico lo enseña). */
export function rotuloTramo(x: number): string {
  return NOMBRE_TRAMO[TIPOS_TRAMO[tipoTramo(Math.floor(x / 25))]];
}
