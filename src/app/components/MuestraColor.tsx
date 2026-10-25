import { PALETA_COCHES, type ColorCoche } from "@/game/colores-coche";

/** Cuadrito con el color de un coche. El nombre del coche va siempre al lado: el color nunca es el único canal. */
export function MuestraColor({ color }: { color: ColorCoche }) {
  return <span className="muestra-color" data-color={color} data-testid="muestra-color" style={{ background: PALETA_COCHES[color].hex }} aria-hidden="true" />;
}
