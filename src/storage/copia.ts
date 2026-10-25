import { esColorCoche } from "@/game/colores-coche";
import type { EvolutionState } from "@/evolution/ga";
import { PRUEBAS_LLANA_ID, TRACKS } from "@/sim/tracks";
import { compararMarcas, type Marca } from "@/sim/clasificacion";
import { nombrePropuesto } from "@/app/nombres";
import { normalizarNombre } from "./nombres";
import {
  bestStepValido,
  causaValida,
  isDate,
  KEY_EVOLUTION,
  KEY_GARAGE,
  KEY_RANKINGS,
  pendienteValida,
  piezasValidas,
  type Rankings,
  type SavedCar,
} from "./schema";
import { clavesRegistradas, validarEstricto } from "./store";

export const COPIA_FORMAT = "darwin-drive-copia";
export const COPIA_VERSION = 1;
export const COPIA_MAX_BYTES = 5 * 1024 * 1024;

export const COPIA_INVALIDA =
  "Este fichero no es una copia de Darwin Drive o es de una versión que no entiendo. No se ha cambiado nada.";

export interface Copia {
  format: typeof COPIA_FORMAT;
  v: typeof COPIA_VERSION;
  exportedAt: string;
  data: Record<string, unknown>;
}

export type ResultadoCopia = { ok: true; data: Record<string, unknown>; resumen: string } | { ok: false; motivo: string };

export function crearCopia(data: Record<string, unknown>, ahora: Date): Copia {
  // Solo las claves registradas: lo que el juego no entiende no viaja en la copia.
  const limpia: Record<string, unknown> = {};
  for (const { key } of clavesRegistradas()) if (key in data) limpia[key] = data[key];
  return { format: COPIA_FORMAT, v: COPIA_VERSION, exportedAt: ahora.toISOString(), data: limpia };
}

/** AAAA-MM-DD en hora local: es el día que la persona ve en su calendario. */
export function nombreFicheroCopia(ahora: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `darwin-drive-copia-${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}.json`;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «4 rankings con 23 marcas, 7 coches, evolución en la gen 12» */
export function resumenCopia(data: Record<string, unknown>): string {
  const rankings = data[KEY_RANKINGS] as Rankings | null | undefined;
  const listas = rankings ? TRACKS.map((t) => rankings[t.id]).filter((l) => l.length > 0) : [];
  const marcas = listas.reduce((suma, l) => suma + l.length, 0);
  const garaje = (data[KEY_GARAGE] as SavedCar[] | null | undefined) ?? [];
  const evolucion = data[KEY_EVOLUTION] as EvolutionState | null | undefined;
  const partes = [
    `${plural(listas.length, "ranking", "rankings")} con ${plural(marcas, "marca", "marcas")}`,
    plural(garaje.length, "coche", "coches"),
    evolucion ? `evolución en la gen ${evolucion.generation}` : "sin evolución",
  ];
  return partes.join(", ");
}

/** JSON con las claves ordenadas: dos valores iguales dan el mismo texto aunque vengan en otro orden. */
function canonico(v: unknown): string {
  return JSON.stringify(v, (_clave, valor: unknown) =>
    typeof valor === "object" && valor !== null && !Array.isArray(valor)
      ? Object.fromEntries(Object.entries(valor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : valor,
  );
}

/**
 * Valida el texto de un fichero sin tocar nada. Tope de tamaño, formato y
 * versión, y cada clave contra su validador sin perdonar entradas sueltas.
 */
/**
 * El nombre es lo único que una copia puede traer «sucio» sin que deje de ser una copia legítima (una persona puede
 * editarla a mano): se normaliza antes de comparar, y el resto de campos siguen sin perdonarse.
 */
function conNombresNormalizados(key: string, valor: unknown): unknown {
  const limpiar = (item: unknown, propuesto: string): unknown => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
    const o = item as Record<string, unknown>;
    // Un color fuera de la paleta no invalida el coche: se quita y se pinta con el predeterminado.
    const { color, ...resto } = o;
    const conColor = esColorCoche(color) ? { ...resto, color } : resto;
    if (typeof o.name !== "string") return conColor;
    return { ...conColor, name: normalizarNombre(o.name, propuesto) };
  };
  if (key === KEY_GARAGE && Array.isArray(valor)) {
    return valor.map((c) => limpiar(c, nombrePropuesto(String((c as { id?: unknown } | null)?.id ?? ""))));
  }
  if (key === KEY_RANKINGS && typeof valor === "object" && valor !== null && !Array.isArray(valor)) {
    // Una copia de antes de las pistas nuevas no trae su clave: el validador la rellena vacía y, sin añadirla aquí,
    // la comparación estricta de abajo rechazaría una copia legítima.
    const completa = { ...Object.fromEntries(TRACKS.map((t) => [t.id, []])), ...valor };
    return Object.fromEntries(
      Object.entries(completa).map(([pista, lista]) => [
        pista,
        Array.isArray(lista) ? lista.map((e) => limpiar(e, nombrePropuesto(String((e as { genomeHash?: unknown } | null)?.genomeHash ?? "")))) : lista,
      ]),
    );
  }
  return valor;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * El validador reordena cada ranking con compararMarcas, y quitar un bestStep cambia ese orden: se ordena aquí igual
 * para que la comparación estricta no vea una diferencia que no es de la copia. Si hay algo que no es una marca, se
 * deja como está y el validador la rechaza.
 */
function ordenarMarcas(lista: unknown[]): unknown[] {
  if (!lista.every((e) => esObjeto(e) && typeof e.distance === "number")) return lista;
  return [...(lista as Marca[])].sort(compararMarcas);
}

/**
 * Los campos de marca fuera de rango no son una copia rota: al cargar lo guardado se quitan y la marca queda pendiente
 * de volver a medirse. Se quitan aquí, antes de la comparación estricta, para que esa comparación siga exigiendo
 * igualdad en todo lo estructural (genoma, ids, pistas) y no en lo que el juego sabe volver a medir.
 */
function conMarcasSaneadas(key: string, valor: unknown, ahora: string): unknown {
  const sanearEntrada = (e: unknown): unknown => {
    if (!esObjeto(e)) return e;
    const o = { ...e };
    // Un solo campo de marca roto invalida la medida entera: sin bestStep la entrada queda pendiente y la migración
    // la vuelve a medir, en vez de quedarse con una marca a medias (piezas o causa sin medir).
    const rota =
      !bestStepValido(o.bestStep) ||
      ("piezasPerdidas" in o && !piezasValidas(o.piezasPerdidas)) ||
      ("causaParada" in o && !causaValida(o.causaParada)) ||
      ("pendienteParada" in o && !pendienteValida(o.pendienteParada));
    if (rota) {
      delete o.bestStep;
      delete o.piezasPerdidas;
      delete o.causaParada;
      delete o.pendienteParada;
    }
    if (!isDate(o.date)) o.date = ahora;
    return o;
  };
  // «pruebas-llana» es la pista del modo de pruebas: no viaja en una copia legítima y se ignora sin más.
  // Cualquier otra pista desconocida sigue rechazando la copia.
  const sinLlana = (m: unknown): unknown => {
    if (!esObjeto(m)) return m;
    const resto = { ...m };
    delete resto[PRUEBAS_LLANA_ID];
    return resto;
  };
  if (key === KEY_RANKINGS && esObjeto(valor)) {
    return Object.fromEntries(
      Object.entries(sinLlana(valor) as Record<string, unknown>).map(([pista, lista]) => [pista, Array.isArray(lista) ? ordenarMarcas(lista.map(sanearEntrada)) : lista]),
    );
  }
  if (key === KEY_GARAGE && Array.isArray(valor)) {
    return valor.map((c) => {
      if (!esObjeto(c)) return c;
      const coche: Record<string, unknown> = { ...c, marks: sinLlana(c.marks) };
      if ("markVersions" in coche) coche.markVersions = sinLlana(coche.markVersions);
      if ("markDetails" in coche) coche.markDetails = sinLlana(coche.markDetails);
      if (esObjeto(coche.markVersions)) {
        const v = Object.fromEntries(
          Object.entries(coche.markVersions).filter(([, x]) => esObjeto(x) && Number.isInteger(x.trackVersion) && Number.isInteger(x.physicsVersion)),
        );
        if (Object.keys(v).length > 0) coche.markVersions = v;
        else delete coche.markVersions;
      }
      if (esObjeto(coche.markDetails)) {
        const d = Object.fromEntries(
          Object.entries(coche.markDetails)
            .filter(
              ([, x]) =>
                esObjeto(x) &&
                bestStepValido(x.bestStep) &&
                piezasValidas(x.piezasPerdidas) &&
                (!("causaParada" in x) || causaValida(x.causaParada)) &&
                (!("pendienteParada" in x) || pendienteValida(x.pendienteParada)),
            ),
        );
        if (Object.keys(d).length > 0) coche.markDetails = d;
        else delete coche.markDetails;
      }
      return coche;
    });
  }
  return valor;
}

export function validarCopia(texto: string, bytes: number = new TextEncoder().encode(texto).length): ResultadoCopia {
  const invalida: ResultadoCopia = { ok: false, motivo: COPIA_INVALIDA };
  if (bytes > COPIA_MAX_BYTES) return invalida;
  let raw: unknown;
  try {
    raw = JSON.parse(texto);
  } catch {
    return invalida;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalida;
  const r = raw as Record<string, unknown>;
  if (r.format !== COPIA_FORMAT || r.v !== COPIA_VERSION) return invalida;
  if (typeof r.data !== "object" || r.data === null || Array.isArray(r.data)) return invalida;
  const data = r.data as Record<string, unknown>;
  const conocidas = new Set(clavesRegistradas().map((c) => c.key));
  // Una clave que este juego no conoce viene de otra versión: mejor no importar que perderla en silencio.
  if (Object.keys(data).some((k) => !conocidas.has(k))) return invalida;
  const validos: Record<string, unknown> = {};
  const ahora = new Date().toISOString();
  for (const { key } of clavesRegistradas()) {
    if (!(key in data)) continue;
    const entrada = conNombresNormalizados(key, conMarcasSaneadas(key, data[key], ahora));
    const v = validarEstricto(key, entrada);
    // Los validadores corrigen en vez de rechazar (un genoma fuera de rango se recorta): si lo que
    // sale no es idéntico a lo que entró, el fichero no es una copia que el juego haya escrito.
    if (!v.ok || canonico(v.value) !== canonico(entrada)) return invalida;
    validos[key] = v.value;
  }
  return { ok: true, data: validos, resumen: resumenCopia(validos) };
}
