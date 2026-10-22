import type { TrackId } from "@/sim/tracks";

export interface TrackPalette {
  skyTop: number;
  skyBottom: number;
  far: number;
  near: number;
  earth: number;
  grass: number;
}

// Cada pista tiene su tono: el jugador sabe en cuál está sin leer el título.
export const PALETTES: Record<TrackId, TrackPalette> = {
  cordillera: { skyTop: 0x6fa8dc, skyBottom: 0xdbeafa, far: 0x8aa0bd, near: 0x5f7f6b, earth: 0x8a5a33, grass: 0x4f9a2c },
  rampa: { skyTop: 0xe8905a, skyBottom: 0xfbe3c2, far: 0xc79c8a, near: 0xa8705a, earth: 0x9a4a2e, grass: 0xc7842c },
  dunas: { skyTop: 0x4fb3d9, skyBottom: 0xd9f0f7, far: 0xe3c58a, near: 0xd2a45a, earth: 0xd6a757, grass: 0xf3d58a },
  glaciar: { skyTop: 0x3d6f9e, skyBottom: 0xcfe6f5, far: 0x7f9fc4, near: 0x5d7fa8, earth: 0x5f86ad, grass: 0xeaf8ff },
  trampolines: { skyTop: 0x7b4fa8, skyBottom: 0xf3d3ef, far: 0xb08ac4, near: 0x8a5fa8, earth: 0x8a5fa8, grass: 0xffe14d },
  escalera: { skyTop: 0x62717f, skyBottom: 0xd7dde3, far: 0x8b95a0, near: 0x6b7480, earth: 0x7b8794, grass: 0xf0b429 },
  acantilado: { skyTop: 0x5a6d88, skyBottom: 0xe6c9a8, far: 0x8c7b74, near: 0x6e5a52, earth: 0x7a5a45, grass: 0xd9843b },
  recta: { skyTop: 0x5aa0d8, skyBottom: 0xe8f1f8, far: 0x9db4a0, near: 0x7a9a78, earth: 0x8a8f86, grass: 0x6fbf4a },
  mosaico: { skyTop: 0x4f7f8f, skyBottom: 0xe3efe8, far: 0x7f9f94, near: 0x5f8274, earth: 0x6f7f5a, grass: 0xff7a59 },
  pedregal: { skyTop: 0x93a6b8, skyBottom: 0xdfe5ea, far: 0x9aa3ab, near: 0x7d8288, earth: 0x6b6862, grass: 0x9a9a8a },
};

// La llana de pruebas no es una pista del juego (no está en TrackId): comparte el tono de La Cordillera.
PALETTES["pruebas-llana" as TrackId] = PALETTES.cordillera;

export function cssColor(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}
