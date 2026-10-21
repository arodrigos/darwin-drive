export interface BandaMigracionProps {
  hechos: number;
  total: number;
}

/** Banda fina bajo la cabecera: no tapa controles ni recibe toques. */
export function BandaMigracion({ hechos, total }: BandaMigracionProps) {
  return (
    <div className="banda-migracion" role="status" data-testid="banda-migracion">
      Actualizando marcas a la nueva versión · {Math.min(hechos + 1, total)} de {total}
    </div>
  );
}

export interface AvisoMigracionProps {
  coches: number;
  onCerrar: () => void;
}

/** Aviso final, arriba y hasta que se cierra; nunca mientras hay una tarjeta de fin delante. */
export function AvisoMigracion({ coches, onCerrar }: AvisoMigracionProps) {
  return (
    <div className="aviso-migracion" role="status" data-testid="aviso-migracion">
      <span>
        Marcas actualizadas: {coches} {coches === 1 ? "coche vuelto" : "coches vueltos"} a medir con la versión nueva. La evolución en curso sigue en la versión nueva.
      </span>
      <button type="button" className="pastilla" aria-label="Cerrar aviso" onClick={onCerrar} data-testid="aviso-migracion-cerrar">
        ✕
      </button>
    </div>
  );
}

export interface EsperaPestanasProps {
  onRecargar: () => void;
}

/** La migración no empieza con otra pestaña de una versión anterior abierta: se ofrece recargarla. */
export function EsperaPestanas({ onRecargar }: EsperaPestanasProps) {
  return (
    <div className="aviso-migracion" role="status" data-testid="espera-pestanas">
      <span>Hay otras pestañas abiertas con una versión anterior. Las marcas se actualizan cuando se recarguen.</span>
      <button type="button" className="pastilla" onClick={onRecargar} data-testid="recargar-pestanas">
        Recargar las otras pestañas
      </button>
    </div>
  );
}
