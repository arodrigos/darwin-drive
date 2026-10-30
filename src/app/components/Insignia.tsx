import { NOMBRE_MEDALLA, type Medalla } from "../medallas";

/** Icono + nombre; el icono es decorativo porque el nombre ya lo dice el texto. */
export function Insignia({ medalla, testid }: { medalla: Medalla; testid?: string }) {
  return (
    <span className="insignia" data-testid={testid}>
      <span className={`medalla medalla-${medalla}`} aria-hidden="true" />
      {NOMBRE_MEDALLA[medalla]}
    </span>
  );
}
