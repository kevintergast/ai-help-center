import { describe, expect, it } from "vitest";
import { processEmbedBatch, type QueueMessageLike } from "./queue";

/**
 * Queue-Batch-Semantik (Infra-Plan Schritt 6). Verhinderte Fehlerfälle:
 *  - EIN kaputter Artikel reißt den ganzen Batch in den Retry (doppelte
 *    Embedding-Kosten für die gesunden Nachrichten).
 *  - Ungültige Nachrichten retryn endlos (Poison-Message-Schleife).
 */

function msg(body: unknown): QueueMessageLike & { acked: boolean; retried: boolean } {
  const m = {
    body: body as QueueMessageLike["body"],
    acked: false,
    retried: false,
    ack() {
      m.acked = true;
    },
    retry() {
      m.retried = true;
    },
  };
  return m;
}

describe("processEmbedBatch", () => {
  it("pro Nachricht einzeln: Erfolg → ack, Fehler → retry, Rest unbeeinflusst", async () => {
    const ok = msg({ tenantId: "t_a", articleId: "a1" });
    const broken = msg({ tenantId: "t_a", articleId: "explodiert" });
    const alsoOk = msg({ tenantId: "t_b", articleId: "a2" });

    const synced: string[] = [];
    await processEmbedBatch([ok, broken, alsoOk], async (tenantId, articleId) => {
      if (articleId === "explodiert") throw new Error("index down");
      synced.push(`${tenantId}/${articleId}`);
    });

    expect(ok.acked).toBe(true);
    expect(broken.retried).toBe(true);
    expect(broken.acked).toBe(false);
    expect(alsoOk.acked).toBe(true);
    expect(synced).toEqual(["t_a/a1", "t_b/a2"]);
  });

  it("ungültiger Body → ack (verwerfen), NIE retry (keine Poison-Schleife)", async () => {
    const invalid = msg({ tenantId: 42 });
    let syncCalls = 0;
    await processEmbedBatch([invalid], async () => {
      syncCalls += 1;
    });
    expect(invalid.acked).toBe(true);
    expect(invalid.retried).toBe(false);
    expect(syncCalls).toBe(0);
  });
});
