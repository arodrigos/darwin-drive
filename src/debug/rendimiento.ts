// Cifras del panel ?rendimiento=1 que no salen de un evento de entrada: ritmo de la simulación.
// Se actualizan desde los mensajes del ejecutor y se leen cada medio segundo.
export const rendimiento = { cochesPorSegundo: 0 };

let ultimo: { pared: number; sim: number } | null = null;

/** Coches-segundo simulados por segundo real, suavizado; los saltos de adelantarSimulacion no cuentan. */
export function registrarPoses(simTime: number, vivos: number): void {
  const pared = performance.now();
  if (ultimo && simTime > ultimo.sim && pared > ultimo.pared) {
    const dSim = simTime - ultimo.sim;
    if (dSim < 5) {
      const instante = (vivos * dSim) / ((pared - ultimo.pared) / 1000);
      rendimiento.cochesPorSegundo = rendimiento.cochesPorSegundo * 0.7 + instante * 0.3;
    }
  }
  ultimo = { pared, sim: simTime };
}

export function reiniciarRendimiento(): void {
  ultimo = null;
  rendimiento.cochesPorSegundo = 0;
}
