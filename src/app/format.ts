/** «64,2 m»: metros con una cifra decimal y coma. */
export function formatMeters(m: number): string {
  return `${m.toFixed(1).replace(".", ",")} m`;
}

/** Número con coma decimal y `digits` cifras. */
export function formatDecimal(n: number, digits: number): string {
  return n.toFixed(digits).replace(".", ",");
}
