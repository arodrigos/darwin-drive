/** «64,2 m»: metros con una cifra decimal y coma. */
export function formatMeters(m: number): string {
  return `${m.toFixed(1).replace(".", ",")} m`;
}
