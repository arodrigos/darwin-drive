export interface RespuestaPrecache {
  readonly redirected: boolean;
  readonly url: string;
  readonly status: number;
}

// Con la cookie del preview protegido caducada, pedir "/" acaba en un login de
// otro origen con status 200. Guardarlo como si fuera el juego dejaría la app
// instalada abriendo ese login sin red: se rechaza y la instalación falla
// limpia, con el worker anterior intacto.
export function respuestaPrecacheable(respuesta: RespuestaPrecache, origenSw: string): boolean {
  if (respuesta.redirected || respuesta.status !== 200) return false;
  try {
    return new URL(respuesta.url).origin === origenSw;
  } catch {
    return false;
  }
}
