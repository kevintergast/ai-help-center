import { READ_TOOLS } from "./read";
import { INSIGHT_TOOLS } from "./insights";
import { WRITE_TOOLS } from "./write";
import { DESTRUCTIVE_TOOLS } from "./destructive";
import { hasScope } from "@/server/apikeys/scopes";
import type { ApiKeyPrincipal } from "@/server/apikeys/keys";
import type { McpTool } from "./types";

/**
 * WERKZEUG-REGISTRY. Eine Liste, zwei Ableitungen:
 *   - was `tools/list` zeigt  (Ergonomie)
 *   - was `tools/call` zulässt (Sicherheit)
 * Beide lesen `tool.scope` — deshalb kann „im Client nicht sichtbar" nie
 * versehentlich zu „trotzdem aufrufbar" werden. Getestet wird beides getrennt.
 */
export const ALL_TOOLS: McpTool[] = [
  ...READ_TOOLS,
  ...INSIGHT_TOOLS,
  ...WRITE_TOOLS,
  ...DESTRUCTIVE_TOOLS,
];

/** Die Werkzeuge, die dieser Schlüssel benutzen darf. */
export function toolsFor(principal: ApiKeyPrincipal): McpTool[] {
  return ALL_TOOLS.filter((t) => hasScope(principal.scopes, t.scope));
}

export function findTool(name: string): McpTool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export type { McpTool, ToolContext, ToolResult } from "./types";
