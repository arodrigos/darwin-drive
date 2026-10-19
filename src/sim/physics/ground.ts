import "../detmath";
import { Chain, Vec2, type Body, type World } from "planck";
import { SEGMENT_LENGTH, VERTEX_SPACING, segmentVertices } from "../terrain";
import type { Track } from "../tracks";

/** Cuánto suelo se mantiene por delante y por detrás de lo que rueda. */
export const GROUND_AHEAD = 35;
export const GROUND_BEHIND = 25;

export interface Ground {
  /** Crea los tramos que falten entre [minX − atrás, maxX + delante] y destruye el resto. */
  ensure(minX: number, maxX: number): void;
  dispose(): void;
}

/**
 * Suelo por tramos de 25 m, cada uno una ChainShape con vértices fantasma
 * tomados del perfil vecino: sin ellos, una rueda choca con el extremo de un
 * tramo al pasar al siguiente (colisión fantasma).
 */
export function createGround(world: World, heightAt: (x: number) => number): Ground {
  const track = { heightAt } as Track;
  const segments = new Map<number, Body>();

  function build(index: number): Body {
    const verts = segmentVertices(track, index).map((p) => Vec2(p.x, p.y));
    const first = verts[0].x;
    const last = verts[verts.length - 1].x;
    const body = world.createBody({ type: "static" });
    const chain = new Chain(verts, false);
    chain.setPrevVertex(Vec2(first - VERTEX_SPACING, heightAt(first - VERTEX_SPACING)));
    chain.setNextVertex(Vec2(last + VERTEX_SPACING, heightAt(last + VERTEX_SPACING)));
    body.createFixture(chain, { friction: 1, density: 0 });
    return body;
  }

  return {
    ensure(minX, maxX) {
      const lo = Math.floor((minX - GROUND_BEHIND) / SEGMENT_LENGTH);
      const hi = Math.floor((maxX + GROUND_AHEAD) / SEGMENT_LENGTH);
      for (const [index, body] of segments) {
        if (index < lo || index > hi) {
          world.destroyBody(body);
          segments.delete(index);
        }
      }
      for (let i = lo; i <= hi; i++) if (!segments.has(i)) segments.set(i, build(i));
    },
    dispose() {
      for (const body of segments.values()) world.destroyBody(body);
      segments.clear();
    },
  };
}
