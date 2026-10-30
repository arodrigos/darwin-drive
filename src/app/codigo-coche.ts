import { PHYSICS_VERSION } from "@/sim/constants";
import { genomeHash, normalizeGenome, type Genome } from "@/sim/genome";
import { limpiarNombre } from "@/storage/nombres";

export type MotivoRechazo = "formato-desconocido" | "version-formato" | "version-fisica" | "demasiado-largo" | "corrupto" | "invalido";

export interface CocheCompartible {
  genome: Genome;
  nombre: string;
  color: string;
}

export type ResultadoDecodificar = { ok: true; coche: CocheCompartible & { hash: string } } | { ok: false; motivo: MotivoRechazo };

const PREFIJO = "DD1.";
const MAX_TEXTO = 4096;
const MAX_BYTES = 16384;
const CLAVES = ["c", "f", "g", "h", "n", "v"];
const COLOR = /^#[0-9a-f]{6}$/i;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

function aBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64url(s: string): Uint8Array | null {
  if (!BASE64URL.test(s) || s.length % 4 === 1) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function leerFlujo(entrada: ReadableStream<Uint8Array>, limite?: number): Promise<Uint8Array | "excede" | null> {
  const lector = entrada.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      // Se corta en streaming: una bomba de deflate no llega a materializarse entera.
      if (limite !== undefined && total > limite) {
        await lector.cancel().catch(() => {});
        return "excede";
      }
      trozos.push(value);
    }
  } catch {
    return null;
  }
  const salida = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) {
    salida.set(t, pos);
    pos += t.length;
  }
  return salida;
}

async function pasarPor(transformador: CompressionStream | DecompressionStream, datos: Uint8Array, limite?: number) {
  const escritor = transformador.writable.getWriter();
  // Sin esperar la escritura: con contrapresión se bloquearía antes de que nadie lea.
  escritor.write(datos as Uint8Array<ArrayBuffer>).catch(() => {});
  escritor.close().catch(() => {});
  return leerFlujo(transformador.readable as ReadableStream<Uint8Array>, limite);
}

export async function codificarCoche(c: CocheCompartible): Promise<string> {
  const json = JSON.stringify({
    v: 1,
    f: PHYSICS_VERSION,
    g: c.genome,
    n: limpiarNombre(c.nombre) || "Coche",
    c: c.color,
    h: genomeHash(c.genome),
  });
  const comprimido = await pasarPor(new CompressionStream("deflate-raw"), new TextEncoder().encode(json));
  if (!(comprimido instanceof Uint8Array)) throw new Error("No se pudo comprimir el coche");
  return PREFIJO + aBase64url(comprimido);
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function iguales(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => iguales(x, b[i]));
  }
  if (esObjeto(a) && esObjeto(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && iguales(a[k], b[k]));
  }
  return a === b;
}

/** Nunca lanza: todo lo que viene de fuera acaba en un motivo. */
export async function decodificarCoche(texto: string): Promise<ResultadoDecodificar> {
  const rechazo = (motivo: MotivoRechazo): ResultadoDecodificar => ({ ok: false, motivo });
  try {
    const t = String(texto).trim();
    if (!t.startsWith(PREFIJO)) return rechazo(/^DD\d+\./.test(t) ? "version-formato" : "formato-desconocido");
    if (t.length > MAX_TEXTO) return rechazo("demasiado-largo");
    const bytes = deBase64url(t.slice(PREFIJO.length));
    if (!bytes) return rechazo("corrupto");
    const plano = await pasarPor(new DecompressionStream("deflate-raw"), bytes, MAX_BYTES);
    if (plano === "excede") return rechazo("demasiado-largo");
    if (!plano) return rechazo("corrupto");
    let o: unknown;
    try {
      o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plano));
    } catch {
      return rechazo("corrupto");
    }
    if (!esObjeto(o)) return rechazo("corrupto");
    if (o.v !== 1) return rechazo("version-formato");
    if (typeof o.f !== "number" || !Number.isInteger(o.f) || o.f < 1) return rechazo("corrupto");
    if (o.f > PHYSICS_VERSION) return rechazo("version-fisica");
    if (!iguales(Object.keys(o).sort(), CLAVES)) return rechazo("corrupto");
    const { g, n, c, h } = o;
    if (typeof n !== "string" || !n || limpiarNombre(n) !== n) return rechazo("invalido");
    if (typeof c !== "string" || !COLOR.test(c)) return rechazo("invalido");
    // La copia normaliza sin avisar; aquí un genoma que la normalización cambiaría no es el que se compartió.
    if (!esObjeto(g) || !iguales(g, normalizeGenome(g))) return rechazo("invalido");
    const genome = g as unknown as Genome;
    const hash = genomeHash(genome);
    if (h !== hash) return rechazo("corrupto");
    return { ok: true, coche: { genome, nombre: n, color: c, hash } };
  } catch {
    return rechazo("corrupto");
  }
}
