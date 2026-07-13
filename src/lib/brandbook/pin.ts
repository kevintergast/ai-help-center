/**
 * PIN-Gate fürs interne Brandbook (Dev-/Test-Oberfläche).
 * Bewusst hartkodiert und clientseitig — schützt keine sensiblen Daten,
 * verbirgt nur die Design-Referenz vor zufälligen Besuchern.
 */
export const BRANDBOOK_PIN = "1479";

/** true, wenn die Eingabe (getrimmt) dem Brandbook-PIN entspricht. */
export function checkPin(input: string): boolean {
  return input.trim() === BRANDBOOK_PIN;
}
