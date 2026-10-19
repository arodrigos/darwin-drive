import type { Genome } from "../sim/genome";
import type { TrackId } from "../sim/tracks";
import type { Op } from "./ga";

export const MAX_LINEAGE_NODES = 3000;

export interface LineageNode {
  id: string;
  parents: string[];
  op: Op;
  generation: number;
  distance: number | null;
  trackId: TrackId | null;
  genome: Genome;
  hue: number;
  humanTouched: boolean;
  prunedParents: boolean;
}
