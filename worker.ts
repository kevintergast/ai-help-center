/**
 * WORKER-ENTRY (Infra-Plan Schritt 6, Workers Paid): umhüllt den von OpenNext
 * GENERIERTEN Handler (.open-next/worker.js, entsteht beim Build — deshalb ist
 * diese Datei vom tsc-Typecheck ausgenommen, tsconfig "exclude"; gebündelt und
 * damit validiert wird sie von Wrangler/esbuild bei jedem Deploy/Dry-Run) und
 * ergänzt den Queue-Consumer der Embedding-Pipeline.
 *
 * `export *` reicht OpenNexts benannte Exporte (z. B. Cache-DO-Klassen) durch,
 * damit deren Bindings weiterhin auflösen; der Default-Export übernimmt
 * fetch & Co. per Spread und ergänzt NUR den queue-Handler.
 */
import openNextHandler from "./.open-next/worker.js";
import { processEmbedBatch, type EmbedQueueMessage } from "./src/server/search/queue";
import { syncArticleIndex } from "./src/server/search/sync";

export * from "./.open-next/worker.js";

const worker = {
  ...openNextHandler,
  async queue(batch: MessageBatch<EmbedQueueMessage>, env: CloudflareEnv): Promise<void> {
    await processEmbedBatch(batch.messages, (tenantId, articleId) =>
      syncArticleIndex(env, tenantId, articleId),
    );
  },
};

export default worker;
