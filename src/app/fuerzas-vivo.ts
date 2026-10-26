import { runtime } from "@/debug/ganchos";
import type { FuerzasMuestra } from "@/sim/constants";
import type { TrackSceneHandle } from "@/game/track-scene";

/** Una pose del Worker llega a la escena y, si trae muestra de fuerzas, se cuenta para los ganchos de prueba. */
export function aplicarMuestra(scene: TrackSceneHandle, muestra: FuerzasMuestra | undefined): void {
  scene.setFuerzas(muestra ?? null);
  if (muestra) {
    runtime.fuerzasEnVivo.muestras++;
    runtime.fuerzasEnVivo.ultima = muestra;
  }
}

export function publicarFuerzas(activa: boolean): void {
  runtime.fuerzasEnVivo.activa = activa;
}

export function reiniciarFuerzasVivo(): void {
  runtime.fuerzasEnVivo.activa = false;
  runtime.fuerzasEnVivo.muestras = 0;
  runtime.fuerzasEnVivo.ultima = null;
  runtime.fuerzasEnVivo.flechasPx = [];
}
