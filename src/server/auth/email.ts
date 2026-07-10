/**
 * E-Mail-Kanonisierung vor jedem Store/Compare (trim + lowercase + NFC).
 * Verhindert doppelte Identitäten durch Casing/Unicode-Varianten
 * (Basis für UNIQUE(tenant_id, email COLLATE NOCASE)).
 */
export function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase().normalize("NFC");
}
