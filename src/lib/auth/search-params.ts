/** Liest den ersten Wert eines Query-Parameters (string | string[] | undefined). */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
