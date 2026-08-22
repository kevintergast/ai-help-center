/**
 * MCP-PROTOKOLL — JSON-RPC-Rahmen, Versionen, Fehler.
 *
 * Bewusst handgeschrieben statt `@modelcontextprotocol/sdk` (docs/mcp-plan.md
 * §4 E2): das SDK ist Node-`req/res`-geprägt (Shim-Risiko unter OpenNext) und
 * zieht Zod; unsere Fläche ist klein und wird in-process über `app.request()`
 * getestet wie jeder andere API-Vertrag.
 *
 * ZWEI ÄREN, EIN SERVER:
 *  - MODERN (2026-07-28): kein `initialize`, keine Sessions. Jede Nachricht ist
 *    ein eigener POST und trägt Protokollversion + Client-Capabilities in
 *    `params._meta`. Genau deshalb braucht dieser Server KEINEN Zustand — und
 *    damit weder Durable Objects noch einen zweiten Worker.
 *  - LEGACY (2025-03-26 … 2025-11-25): erwartet `initialize`. Wir beantworten
 *    es, vergeben aber KEINE Session-Id (stateless ist auch dort erlaubt).
 *
 * Ausgelieferte Clients sprechen heute überwiegend die Legacy-Ära; deshalb
 * unterstützen wir beide, statt auf die neue Spec zu warten.
 */

/** Absteigend = Präferenz. Erweitern nur mit passendem Konformitäts-Test. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];
export const LATEST_PROTOCOL_VERSION: ProtocolVersion = "2026-07-28";

/** Ab dieser Revision gilt das per-Request-Metadaten-Modell (kein initialize). */
const STATELESS_ERA_VERSION = "2026-07-28";

export const SERVER_INFO = { name: "hallofhelp", version: "1.0.0" } as const;

const META_PREFIX = "io.modelcontextprotocol/";
export const META_PROTOCOL_VERSION = `${META_PREFIX}protocolVersion`;
export const META_CLIENT_INFO = `${META_PREFIX}clientInfo`;
export const META_CLIENT_CAPABILITIES = `${META_PREFIX}clientCapabilities`;
export const META_SERVER_INFO = `${META_PREFIX}serverInfo`;

/**
 * Fehlercodes. `-32020`..`-32099` ist der von der Spec reservierte Bereich —
 * dort dürfen NUR die dort definierten Codes stehen (keine eigenen erfinden).
 */
export const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Header und Body widersprechen sich (Spec: HeaderMismatch). */
  HEADER_MISMATCH: -32020,
  /** Der Client hat eine benötigte Capability nicht deklariert. */
  MISSING_CLIENT_CAPABILITY: -32021,
  /** Protokollversion nicht unterstützt. */
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcErrorBody {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorBody {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * Erfolgsantwort. `resultType: "complete"` verlangt die aktuelle Spec; ältere
 * Clients ignorieren das zusätzliche Feld schlicht — ein Feld für beide Ären.
 */
export function rpcResult(id: JsonRpcId, result: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result: {
      resultType: "complete",
      ...result,
      _meta: { [META_SERVER_INFO]: SERVER_INFO },
    },
  };
}

export function isSupportedVersion(v: unknown): v is ProtocolVersion {
  return typeof v === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v);
}

/** Gehört die Version zur stateless-Ära (per-Request-`_meta`, kein initialize)? */
export function isStatelessEra(v: ProtocolVersion): boolean {
  return v >= STATELESS_ERA_VERSION;
}

/**
 * Der Body ist ein wohlgeformter JSON-RPC-Request?
 * `id` darf laut Spec nicht `null` sein; ohne `id` ist es eine Notification.
 */
export function parseRpcRequest(
  body: unknown,
): { ok: true; request: JsonRpcRequest; isNotification: boolean } | { ok: false } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  if (b.jsonrpc !== "2.0" || typeof b.method !== "string") return { ok: false };
  if ("id" in b && b.id !== undefined) {
    if (typeof b.id !== "string" && typeof b.id !== "number") return { ok: false };
  }
  const params =
    typeof b.params === "object" && b.params !== null && !Array.isArray(b.params)
      ? (b.params as Record<string, unknown>)
      : undefined;
  return {
    ok: true,
    request: { jsonrpc: "2.0", id: b.id as JsonRpcId | undefined, method: b.method, params },
    isNotification: b.id === undefined,
  };
}

/** Die Protokollversion des Requests: Header-Wert, sonst `_meta`, sonst Legacy. */
export function requestedVersion(
  headerValue: string | null | undefined,
  params: Record<string, unknown> | undefined,
): string {
  const meta = params?._meta as Record<string, unknown> | undefined;
  const fromMeta = meta?.[META_PROTOCOL_VERSION];
  if (typeof fromMeta === "string") return fromMeta;
  if (headerValue) return headerValue;
  // Vor 2025-06-18 gab es den Header nicht — die Spec erlaubt, solche Requests
  // als 2025-03-26 zu behandeln (statt sie abzuweisen).
  return "2025-03-26";
}

/**
 * HEADER-BODY-ABGLEICH (Spec: `Mcp-Method`, `Mcp-Name`, `MCP-Protocol-Version`).
 *
 * Warum das eine Sicherheitsprüfung ist und keine Formalie: unterwegs kann eine
 * Zwischenstation (Load Balancer, Gateway, Rate-Limiter) auf die HEADER
 * schauen, während wir den BODY ausführen. Weichen beide ab, entscheidet die
 * Zwischenstation über etwas anderes als das, was passiert.
 *
 * Der Header-Abgleich gilt erst ab der Ära, die ihn definiert — für
 * Legacy-Clients wären fehlende Header sonst ein Totalausfall.
 */
export function checkHeaderBodyMatch(
  headers: { method: string | null; name: string | null; protocolVersion: string | null },
  request: JsonRpcRequest,
  version: string,
): string | null {
  if (version < "2026-07-28") return null;

  if (!headers.protocolVersion) return "missing MCP-Protocol-Version header";
  if (headers.protocolVersion !== version) {
    return `MCP-Protocol-Version header '${headers.protocolVersion}' does not match body value '${version}'`;
  }
  if (!headers.method) return "missing Mcp-Method header";
  if (headers.method !== request.method) {
    return `Mcp-Method header '${headers.method}' does not match body method '${request.method}'`;
  }

  const bodyName = nameOf(request);
  if (bodyName !== null) {
    if (!headers.name) return "missing Mcp-Name header";
    if (decodeHeaderValue(headers.name) !== bodyName) {
      return `Mcp-Name header does not match body value '${bodyName}'`;
    }
  }
  return null;
}

/** Der Wert, den `Mcp-Name` spiegeln muss (null = für diese Methode keiner). */
function nameOf(request: JsonRpcRequest): string | null {
  const p = request.params ?? {};
  if (request.method === "tools/call" || request.method === "prompts/get") {
    return typeof p.name === "string" ? p.name : null;
  }
  if (request.method === "resources/read") {
    return typeof p.uri === "string" ? p.uri : null;
  }
  return null;
}

/**
 * Header-Werte, die nicht ASCII-sicher sind, kommen base64-verpackt an:
 * `=?base64?<wert>?=` (Spec „Value Encoding"). Vor dem Vergleich auspacken —
 * sonst scheitert jeder Tool-Name mit Umlaut am Abgleich.
 */
export function decodeHeaderValue(value: string): string {
  const match = /^=\?base64\?(.*)\?=$/.exec(value);
  if (!match) return value;
  try {
    const bin = atob(match[1]);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}
