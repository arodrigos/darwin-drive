import type { RankingOutcome } from "@/storage/store";
import { RANKING_SIZE } from "@/storage/schema";
import { getTrack, type TrackId } from "@/sim/tracks";
import { formatMeters } from "./format";

/** Frase de la tarjeta de fin: lo que le pasó a la marca en el ranking de su pista. */
export function textoRanking(outcome: RankingOutcome, pista: string, distance: number): string {
  if (outcome.isRecord) return `¡Nuevo récord en ${pista}! ${formatMeters(distance)}`;
  if (outcome.entered) return `Entra en el ranking de ${pista}: puesto ${outcome.position} de ${RANKING_SIZE}`;
  if (outcome.alreadyAt !== null) return `Ya está en el ranking de ${pista}: puesto ${outcome.alreadyAt}`;
  if (outcome.cutoff !== null) return `No entra en el ranking de ${pista}: el ${RANKING_SIZE}.º tiene ${formatMeters(outcome.cutoff)}`;
  return `No entra en el ranking de ${pista}.`;
}

/** Aviso arriba al entrar en un ranking; null si no entró. */
export function avisoRanking(outcome: RankingOutcome, pista: string, distance: number): string | null {
  if (!outcome.entered) return null;
  if (outcome.isRecord) return `¡Nuevo récord en ${pista}! ${formatMeters(distance)}`;
  return `Puesto ${outcome.position} en ${pista} · ${formatMeters(distance)}`;
}

const unir = (items: string[]): string => (items.length > 1 ? `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}` : items[0]);

/** Resumen de «Medir en todas las pistas»: en qué rankings entró el coche y con qué puesto. */
export function resumenMedicion(marcas: { trackId: TrackId; result: { reason: string }; outcome: RankingOutcome }[]): string {
  const nombre = (id: TrackId) => getTrack(id)?.name ?? id;
  const entra = marcas.filter((m) => m.outcome.entered).map((m) => `${nombre(m.trackId)} (puesto ${m.outcome.position})`);
  const ya = marcas.filter((m) => m.outcome.alreadyAt !== null).map((m) => `${nombre(m.trackId)} (puesto ${m.outcome.alreadyAt})`);
  const descalificado = marcas.filter((m) => m.result.reason === "anomaly").map((m) => nombre(m.trackId));
  const partes = [
    entra.length === 0 ? "No entra en ningún ranking." : `Entra en ${entra.length} ${entra.length === 1 ? "ranking" : "rankings"}: ${unir(entra)}.`,
  ];
  if (ya.length > 0) partes.push(`Ya estaba en ${unir(ya)}.`);
  if (descalificado.length > 0) partes.push(`Descalificado en ${unir(descalificado)}.`);
  return partes.join(" ");
}
