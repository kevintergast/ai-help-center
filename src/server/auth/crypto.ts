/**
 * Per-Tenant-Schlüsselableitung via HKDF-SHA256 (Web Crypto — Workers & Node).
 * Ein instanzfremdes Artefakt (Cookie/OAuth-state) scheitert an der Signaturprüfung,
 * weil jeder Tenant einen anderen abgeleiteten Schlüssel hat.
 */
const SALT = "hallofhelp:tenant:v1";

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function deriveTenantKey(baseSecret: string, tenantId: string): Promise<string> {
  if (!baseSecret) throw new Error("baseSecret fehlt");
  if (!tenantId) throw new Error("tenantId fehlt");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(baseSecret), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(SALT), info: enc.encode(tenantId) },
    key,
    256,
  );
  return base64url(new Uint8Array(bits));
}
