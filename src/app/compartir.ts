import { runtime } from "@/debug/ganchos";

export type ResultadoTexto = "compartido" | "copiado" | "cancelado" | "manual";

const nombreError = (e: unknown): string => (e instanceof Error || e instanceof DOMException ? e.name : "");

/**
 * Hoja nativa si existe; si no (o si el navegador la niega fuera de un gesto), portapapeles. «manual» quiere decir
 * que tampoco hay portapapeles y la interfaz debe enseñar el texto seleccionable. Cerrar la hoja no es un error.
 */
export async function compartirTexto(texto: string): Promise<ResultadoTexto> {
  runtime.ultimoCompartido = texto;
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text: texto });
      return "compartido";
    } catch (e) {
      if (nombreError(e) === "AbortError") return "cancelado";
      // NotAllowedError o cualquier otro fallo de la hoja: se cae al portapapeles.
    }
  }
  try {
    await navigator.clipboard.writeText(texto);
    return "copiado";
  } catch {
    return "manual";
  }
}

/** iOS solo comparte ficheros con {files}: sin canShare no se puede asegurar que la hoja los acepte. */
export function puedeCompartirFichero(f: File): boolean {
  return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [f] });
}

export async function compartirFichero(f: File): Promise<"compartido" | "cancelado" | "error"> {
  runtime.ultimoCompartido = f.name;
  try {
    await navigator.share({ files: [f] });
    return "compartido";
  } catch (e) {
    return nombreError(e) === "AbortError" ? "cancelado" : "error";
  }
}

export function descargarFichero(f: File): void {
  runtime.ultimoCompartido = f.name;
  const url = URL.createObjectURL(f);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar en el mismo turno cancelaría la descarga en algunos navegadores.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
