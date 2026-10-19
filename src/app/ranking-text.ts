import type { RankingOutcome } from "@/storage/store";
import { RANKING_SIZE } from "@/storage/schema";
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
