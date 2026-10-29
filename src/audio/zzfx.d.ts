// zzfx no publica tipos; solo se declara lo que usa sonido.ts.
declare module "zzfx" {
  export const ZZFX: {
    volume: number;
    audioContext: AudioContext;
    buildSamples(...parametros: number[]): number[];
    playSamples(canales: number[][], volumen?: number, ritmo?: number, pan?: number, bucle?: boolean): AudioBufferSourceNode;
  };
}
