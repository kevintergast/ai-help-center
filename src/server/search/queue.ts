/**
 * EMBEDDING-QUEUE (Infra-Plan Schritt 6, Workers Paid): Nachrichtenformat +
 * Batch-Verarbeitung. Der Producer (runtime-deps) enqueued pro Content-
 * Änderung EINE Nachricht; der Consumer (Worker-Entry) synchronisiert den
 * Index. Verarbeitung ist idempotent (Status wird beim Verarbeiten gelesen)
 * — Retries sind dadurch immer sicher.
 */

export interface EmbedQueueMessage {
  tenantId: string;
  articleId: string;
}

/** Minimaler Message-/Batch-Ausschnitt (strukturkompatibel zu Workers-Queues). */
export interface QueueMessageLike {
  body: EmbedQueueMessage;
  ack(): void;
  retry(): void;
}

/**
 * Verarbeitet einen Batch: pro Nachricht einzeln ack/retry — EIN kaputter
 * Artikel darf die übrigen Nachrichten des Batches nicht mit in den Retry
 * ziehen (sonst würden deren Embeddings doppelt bezahlt und die Latenz
 * multipliziert sich).
 */
export async function processEmbedBatch(
  messages: readonly QueueMessageLike[],
  sync: (tenantId: string, articleId: string) => Promise<void>,
): Promise<void> {
  for (const message of messages) {
    const { tenantId, articleId } = message.body ?? ({} as EmbedQueueMessage);
    if (typeof tenantId !== "string" || typeof articleId !== "string") {
      // Kaputte Nachricht: Retry wäre eine Endlosschleife → verwerfen (laut).
      console.error("[embed-queue] verworfene Nachricht (ungültiger Body):", message.body);
      message.ack();
      continue;
    }
    try {
      await sync(tenantId, articleId);
      message.ack();
    } catch (err) {
      console.error(`[embed-queue] sync fehlgeschlagen (${tenantId}/${articleId}):`, err);
      message.retry();
    }
  }
}
