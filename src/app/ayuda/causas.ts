import { TORQUE_SLOPE_DEG, type CausaParada } from "@/sim/constants";

const SE_PARO = "Se paró.";

const TEXTOS: Record<Exclude<CausaParada, "motor">, string> = {
  agarre: "Las ruedas patinan: giran pero no agarran. Con ruedas más grandes o más peso sobre ellas, el coche se agarra mejor.",
  vuelco: "Volcó y se quedó boca abajo. Una carrocería más baja y ancha aguanta mejor las cuestas y los escalones.",
  panza: "Se quedó sentado sobre la carrocería, con las ruedas casi sin apoyo. Súbela o usa ruedas más grandes para salvar las crestas.",
  "sin-apoyo": "Ninguna rueda toca el suelo. Ponle al menos una rueda que llegue hasta él.",
  obstaculo: "Se topó con un obstáculo que no pudo salvar. Las ruedas más grandes suben escalones más altos.",
  rotura: "Se rompió y perdió las ruedas: sin ellas no puede empujar. Una carrocería más gruesa y sin esquinas finas aguanta mejor los golpes.",
};

const EN_PEDAZOS = "Se rompió en pedazos: casi no le quedó carrocería. Más densidad y menos esquinas finas la hacen aguantar los golpes.";

/** El motor de todos los coches empuja hasta TORQUE_SLOPE_DEG: la frase lo dice con el número real de la constante. */
export function textoCausa(causa: CausaParada | null | undefined, pendiente?: number | null, destrozado = false): string {
  if (destrozado) return EN_PEDAZOS;
  if (causa === "motor") {
    const n = typeof pendiente === "number" && Number.isFinite(pendiente) ? Math.round(pendiente) : TORQUE_SLOPE_DEG;
    return `Cuesta de ${n}°: más de lo que puede empujar el motor (${TORQUE_SLOPE_DEG}°). Todos los coches tienen ese límite: solo pasa quien llega lanzado.`;
  }
  if (typeof causa === "string" && Object.hasOwn(TEXTOS, causa)) return TEXTOS[causa as keyof typeof TEXTOS];
  return SE_PARO;
}
