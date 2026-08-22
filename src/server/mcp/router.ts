import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiDeps, ApiEnv } from "@/server/api/context";
import { allowRequest } from "@/server/api/rate-limit";
import { hasScope } from "@/server/apikeys/scopes";
import { findTool, toolsFor } from "./tools";
import type { ConfirmationCodec, ToolContext } from "./tools/types";
import { makeConfirmationCodec } from "./confirm";
import {
  checkHeaderBodyMatch,
  decodeHeaderValue,
  isSupportedVersion,
  JSON_RPC,
  LATEST_PROTOCOL_VERSION,
  parseRpcRequest,
  requestedVersion,
  rpcError,
  rpcResult,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcId,
} from "./protocol";

/**
 * MCP-ENDPOINT (`POST /api/v1/mcp`) — ein Pfad, JSON-RPC im Body.
 *
 * Authentifiziert ist der Request bereits: die Default-Deny-Schicht in app.ts
 * lässt hier nur einen gültigen Bearer-API-Key durch und legt den Prinzipal in
 * den Context (`apiKey`). Dieser Router entscheidet nur noch über Protokoll,
 * Werkzeugauswahl und Scopes.
 *
 * STATELESS: kein `Mcp-Session-Id`, kein GET-Stream, keine Wiederaufnahme. Die
 * aktuelle Spec verlangt genau das nicht mehr — und deshalb braucht dieser
 * Server weder Durable Objects noch einen zweiten Worker (docs/mcp-plan.md §3).
 *
 * CORS: `*` ohne `Allow-Credentials`. Das ist nur deshalb sicher, weil hier
 * ausschließlich Bearer zählt und niemals ein Cookie (machine-routes.ts) —
 * eine fremde Seite kann also nichts „mitschicken", was sie nicht kennt.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name",
  "Access-Control-Max-Age": "86400",
} as const;

/** Erlaubte Origins für Browser-Clients (DNS-Rebinding-Schutz der Spec). */
function originAllowed(origin: string | undefined): boolean {
  // Kein Origin = kein Browser (CLI, Server, Desktop-Client) → nichts zu prüfen.
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") {
      // Lokale Entwicklung darf http, sonst nichts.
      return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    }
    return true;
  } catch {
    return false;
  }
}

export function mcpRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.options("/", (c) => c.body(null, 204, CORS_HEADERS));

  // Legacy-Clients der Session-Ära versuchen GET (SSE-Stream) und DELETE
  // (Session beenden). Beides gibt es hier nicht — die Spec schreibt 405 vor.
  r.on(["GET", "DELETE"], "/", (c) => c.json({ error: "method_not_allowed" }, 405, CORS_HEADERS));

  r.post("/", async (c) => {
    if (!originAllowed(c.req.header("origin"))) {
      return json(c, rpcError(null, JSON_RPC.INVALID_REQUEST, "Origin not allowed"), 403);
    }

    const principal = c.get("apiKey");
    if (!principal) {
      // Kann im Normalfall nicht passieren (Default-Deny läuft davor) — aber
      // ein Router, der sich darauf verlässt, wäre beim nächsten Umbau eine Lücke.
      return json(c, rpcError(null, JSON_RPC.INVALID_REQUEST, "Unauthorized"), 401);
    }

    // Rate-Limit pro SCHLÜSSEL: ein Agent in einer Schleife ist der Normalfall,
    // und mehrere Kunden teilen sich oft dieselbe Ausgangs-IP.
    const allowed = await allowRequest(
      deps.rateLimiters?.mcp,
      `mcp:${c.get("tenant").id}:${principal.keyId}`,
    );
    if (!allowed) {
      return json(c, rpcError(null, JSON_RPC.INVALID_REQUEST, "Rate limit exceeded"), 429);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json(c, rpcError(null, JSON_RPC.PARSE_ERROR, "Invalid JSON"), 400);
    }

    const parsed = parseRpcRequest(body);
    if (!parsed.ok) {
      return json(c, rpcError(null, JSON_RPC.INVALID_REQUEST, "Not a valid JSON-RPC 2.0 request"), 400);
    }
    const { request, isNotification } = parsed;
    const id: JsonRpcId = request.id ?? 0;

    // ── Protokollversion ───────────────────────────────────────────────────
    const version = requestedVersion(c.req.header("mcp-protocol-version"), request.params);
    if (!isSupportedVersion(version)) {
      return json(
        c,
        rpcError(id, JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version '${version}'`, {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
        }),
        400,
      );
    }

    // ── Header-Body-Abgleich (ab der Ära, die ihn definiert) ───────────────
    const mismatch = checkHeaderBodyMatch(
      {
        method: c.req.header("mcp-method") ?? null,
        name: c.req.header("mcp-name") ?? null,
        protocolVersion: c.req.header("mcp-protocol-version") ?? null,
      },
      request,
      version,
    );
    if (mismatch) return json(c, rpcError(id, JSON_RPC.HEADER_MISMATCH, mismatch), 400);

    // Notifications werden quittiert, nicht beantwortet (Spec: 202, kein Body).
    if (isNotification) return c.body(null, 202, CORS_HEADERS);

    switch (request.method) {
      // Legacy-Handshake: beantwortet, aber ohne Session-Id — der Server bleibt
      // zustandslos, auch wenn der Client aus der Session-Ära kommt.
      case "initialize":
        return json(
          c,
          rpcResult(id, {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              "Help center content server. Call get_content_conventions before writing articles, and get_permissions to see what this key may do. New articles are always drafts.",
          }),
          200,
        );

      case "ping":
        return json(c, rpcResult(id, {}), 200);

      case "tools/list": {
        const tools = toolsFor(principal).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.annotations ? { annotations: t.annotations } : {}),
        }));
        return json(c, rpcResult(id, { tools }), 200);
      }

      case "tools/call": {
        const params = request.params ?? {};
        const rawName = typeof params.name === "string" ? params.name : "";
        const name = decodeHeaderValue(rawName);
        const tool = findTool(name);
        if (!tool) {
          return json(c, rpcError(id, JSON_RPC.INVALID_PARAMS, `Unknown tool '${name}'`), 400);
        }

        // SCOPE-PRÜFUNG — die eigentliche Kontrolle. Dass gesperrte Werkzeuge in
        // `tools/list` fehlen, ist nur Ergonomie; hier wird entschieden.
        if (!hasScope(principal.scopes, tool.scope)) {
          return c.json(
            rpcError(id, JSON_RPC.INVALID_PARAMS, `This access key lacks the '${tool.scope}' permission.`, {
              requiredScope: tool.scope,
              grantedScopes: principal.scopes,
              hint: "Ask the user to grant this permission to the key in the help center admin area.",
            }),
            403,
            {
              ...CORS_HEADERS,
              "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${tool.scope}"`,
            },
          );
        }

        const args =
          typeof params.arguments === "object" && params.arguments !== null
            ? (params.arguments as Record<string, unknown>)
            : {};

        const ctx: ToolContext = {
          tenant: c.get("tenant"),
          principal,
          deps,
          nowSec: Math.floor(Date.now() / 1000),
          confirmations: (await deps.getConfirmations?.(c.get("tenant").id)) ?? fallbackConfirmations(),
        };

        try {
          const result = await tool.handler(args, ctx);
          return json(c, rpcResult(id, { ...result }), 200);
        } catch (err) {
          // Unerwartetes bleibt ein PROTOKOLL-Fehler (nicht `isError`): das ist
          // ein Serverdefekt, kein Fachergebnis, das das Modell reparieren kann.
          console.error(`[mcp] Tool '${name}' fehlgeschlagen:`, err);
          return json(c, rpcError(id, JSON_RPC.INTERNAL_ERROR, "Internal server error"), 500);
        }
      }

      default:
        // Spec: unbekannte Methode → HTTP 404 mit JSON-RPC -32601 (unterscheidet
        // uns von einem Server, der diesen Pfad gar nicht kennt).
        return json(c, rpcError(id, JSON_RPC.METHOD_NOT_FOUND, `Unknown method '${request.method}'`), 404);
    }
  });

  return r;
}

/**
 * Notnagel ohne konfigurierte Krypto-Infrastruktur (lokale Entwicklung, Tests
 * ohne eigenes Fixture): ein Codec mit zufälligem Prozess-Secret. Signatur und
 * Ablauf greifen weiterhin — Bestätigungen bleiben also unfälschbar; nur der
 * Einmalverbrauch überlebt keinen Isolate-Wechsel. Deployed liefert
 * runtime-deps immer den echten Codec (AUTH_SECRET + KV).
 */
let FALLBACK: ConfirmationCodec | null = null;
function fallbackConfirmations(): ConfirmationCodec {
  return (FALLBACK ??= makeConfirmationCodec({
    secret: crypto.randomUUID(),
    now: () => Math.floor(Date.now() / 1000),
  }));
}

function json(c: Context<ApiEnv>, body: unknown, status: 200 | 202 | 400 | 401 | 403 | 404 | 429 | 500) {
  return c.json(body as Record<string, unknown>, status, {
    ...CORS_HEADERS,
    "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
  });
}
