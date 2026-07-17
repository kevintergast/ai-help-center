import { creditsFor } from "@product/server/billing/pricing";

/**
 * SELBSTKOSTENRECHNER für individuelle Deals (Enterprise-Rahmen): rechnet
 * Deal-Volumina (KI-Antworten, Übersetzungen, Views, …) in reale
 * Cloudflare-Kosten um — als Grundlage für Preis und custom_included_credits/
 * custom_mau_limit einer Enterprise-Instanz.
 *
 * REINE Daten + pure Funktion, kein I/O. Alle Zahlen sind im /kosten-Formular
 * editierbar; die Defaults hier sind nur Startwerte:
 *  - PREISE = Cloudflare-LISTENPREISE (verifiziert 2026-07-17 gegen
 *    developers.cloudflare.com; bei Preisänderungen hier nachziehen):
 *    llama-3.3-70b-instruct-fp8-fast $0.293/M in · $2.253/M out;
 *    bge-m3 $0.012/M Tokens; Vectorize $0.01/M Query-Dims (Formel lt. Doku:
 *    (Queries + Upserts) × Dims) + $0.05/100M gespeicherte Dims;
 *    D1 $0.001/M Reads · $1.00/M Writes.
 *  - ANNAHMEN (Tokens je Antwort etc.) = grobe Schätzwerte — mit echten
 *    Zahlen aus den AI-Gateway-Logs kalibrieren.
 *  - KONSERVATIV: monatliche Freikontingente (50M Vectorize-Dims, 25B/50M
 *    D1-Reads/Writes, 10M Workers-Requests, …) werden NICHT abgezogen — sie
 *    gehören der Plattform insgesamt, nicht dem einzelnen Deal.
 */

/** bge-m3 → 1024 Dimensionen (models.ts / Vectorize-Indizes). */
export const VECTOR_DIMENSIONS = 1024;

export interface DealVolumes {
  /** Beantwortete KI-Fragen (ai_generation) pro Monat. */
  kiAntworten: number;
  /** KI-Fragen OHNE geerdete Antwort: kosten Embedding+Vectorize, aber keine
   *  Generierung und keine Credits — reiner Kostenposten ohne Umsatz. */
  kiOhneAntwort: number;
  uebersetzungen: number;
  views: number;
  mau: number;
  /** Veröffentlichte Artikel (Bestand) — treibt Index-/Speicherkosten. */
  artikel: number;
}

export interface DealAssumptions {
  tokensInAntwort: number;
  tokensOutAntwort: number;
  tokensInUebersetzung: number;
  tokensOutUebersetzung: number;
  /** Embedding-Tokens je Frage (beantwortet oder nicht). */
  tokensFrage: number;
  tokensChunk: number;
  chunksProArtikel: number;
  /** Wie oft der Artikelbestand pro Monat neu indexiert wird (Re-Publish). */
  reindexProMonat: number;
  d1ReadsProView: number;
  d1WritesProView: number;
  d1ReadsProFrage: number;
  d1WritesProFrage: number;
}

export interface DealPrices {
  llmInUsdProMTok: number;
  llmOutUsdProMTok: number;
  embedUsdProMTok: number;
  vectorizeQueryUsdProMDim: number;
  vectorizeStorageUsdPro100MDim: number;
  d1ReadUsdProMRows: number;
  d1WriteUsdProMRows: number;
  /** Workers Paid Basis + Grundrauschen (R2/KV/Requests), anteilig je Deal. */
  fixkostenUsdMonat: number;
  /** Pauschale für Kleinposten (R2-Ops, Mails, CPU-ms), falls gewünscht. */
  sonstigesUsdMonat: number;
  eurProUsd: number;
}

export const DEFAULT_VOLUMES: DealVolumes = {
  kiAntworten: 1_000,
  kiOhneAntwort: 300,
  uebersetzungen: 10,
  views: 20_000,
  mau: 2_000,
  artikel: 50,
};

export const DEFAULT_ASSUMPTIONS: DealAssumptions = {
  // ~400 System-Prompt + 6 Kontext-Chunks à ~400 + Frage (grounding.ts:
  // MAX_CONTEXT_CHUNKS=6) — mit AI-Gateway-Logs kalibrieren.
  tokensInAntwort: 3_000,
  tokensOutAntwort: 500,
  // Ganzer Artikel rein + raus (translate.ts, maxTokens 4096).
  tokensInUebersetzung: 3_000,
  tokensOutUebersetzung: 3_000,
  tokensFrage: 50,
  tokensChunk: 400,
  chunksProArtikel: 3,
  reindexProMonat: 1,
  d1ReadsProView: 5,
  d1WritesProView: 2,
  d1ReadsProFrage: 15,
  d1WritesProFrage: 4,
};

export const DEFAULT_PRICES: DealPrices = {
  llmInUsdProMTok: 0.293,
  llmOutUsdProMTok: 2.253,
  embedUsdProMTok: 0.012,
  vectorizeQueryUsdProMDim: 0.01,
  vectorizeStorageUsdPro100MDim: 0.05,
  d1ReadUsdProMRows: 0.001,
  d1WriteUsdProMRows: 1.0,
  fixkostenUsdMonat: 5,
  sonstigesUsdMonat: 0,
  eurProUsd: 0.92,
};

export interface CostLine {
  label: string;
  /** Menge in der Einheit des Postens (Tokens, Dims, Rows …), fürs UI. */
  detail: string;
  usd: number;
}

export interface DealCosts {
  lines: CostLine[];
  variabelUsd: number;
  fixUsd: number;
  gesamtUsd: number;
  gesamtEur: number;
  /** Credits, die dieser Mix im Produkt verbraucht (creditsFor, Endnutzer). */
  credits: number;
  /** Empfehlung für custom_included_credits: +20 % Puffer, auf 1.000 gerundet. */
  creditsDeckelEmpfehlung: number;
  /** Empfehlung für custom_mau_limit: +20 % Puffer, auf 100 gerundet. */
  mauDeckelEmpfehlung: number;
  /** Grenzkosten EINER beantworteten KI-Frage (LLM+Embedding+Vectorize+D1). */
  jeAntwortUsd: number;
  /** Variable Kosten je 1.000 verbrauchter Credits (null, wenn 0 Credits). */
  je1kCreditsEur: number | null;
}

const nf = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));

export function computeDealCosts(
  v: DealVolumes,
  a: DealAssumptions,
  p: DealPrices,
): DealCosts {
  const fragen = v.kiAntworten + v.kiOhneAntwort;

  const llmIn = v.kiAntworten * a.tokensInAntwort + v.uebersetzungen * a.tokensInUebersetzung;
  const llmOut = v.kiAntworten * a.tokensOutAntwort + v.uebersetzungen * a.tokensOutUebersetzung;
  const llmUsd = (llmIn / 1e6) * p.llmInUsdProMTok + (llmOut / 1e6) * p.llmOutUsdProMTok;

  const indexEmbedTokens = v.artikel * a.chunksProArtikel * a.tokensChunk * a.reindexProMonat;
  const embedTokens = fragen * a.tokensFrage + indexEmbedTokens;
  const embedUsd = (embedTokens / 1e6) * p.embedUsdProMTok;

  // Vectorize-Doku-Formel: (Queries + upgesertete Vektoren) × Dimensionen.
  const upserts = v.artikel * a.chunksProArtikel * a.reindexProMonat;
  const queriedDims = (fragen + upserts) * VECTOR_DIMENSIONS;
  const storedDims = v.artikel * a.chunksProArtikel * VECTOR_DIMENSIONS;
  const vectorizeUsd =
    (queriedDims / 1e6) * p.vectorizeQueryUsdProMDim +
    (storedDims / 1e8) * p.vectorizeStorageUsdPro100MDim;

  const d1Reads = v.views * a.d1ReadsProView + fragen * a.d1ReadsProFrage;
  const d1Writes = v.views * a.d1WritesProView + fragen * a.d1WritesProFrage;
  const d1Usd = (d1Reads / 1e6) * p.d1ReadUsdProMRows + (d1Writes / 1e6) * p.d1WriteUsdProMRows;

  const lines: CostLine[] = [
    {
      label: "LLM-Generierung (Antworten + Übersetzungen)",
      detail: `${nf(llmIn)} Tokens rein · ${nf(llmOut)} raus`,
      usd: llmUsd,
    },
    {
      label: "Embeddings (Fragen + Indexierung)",
      detail: `${nf(embedTokens)} Tokens`,
      usd: embedUsd,
    },
    {
      label: "Vectorize (Suche + Index-Speicher)",
      detail: `${nf(queriedDims)} Query-Dims · ${nf(storedDims)} gespeichert`,
      usd: vectorizeUsd,
    },
    {
      label: "D1 (Events, Dedup, Zähler)",
      detail: `${nf(d1Reads)} Reads · ${nf(d1Writes)} Writes`,
      usd: d1Usd,
    },
  ];

  const variabelUsd = llmUsd + embedUsd + vectorizeUsd + d1Usd + p.sonstigesUsdMonat;
  const fixUsd = p.fixkostenUsdMonat;
  const gesamtUsd = variabelUsd + fixUsd;

  // Credits des Mixes über DIE Produkt-Preisregel (Endnutzer = Listenpreis;
  // Übersetzungen kosten IMMER voll). Nicht-geerdete Fragen kosten 0 Credits.
  const credits =
    v.views * creditsFor("article_view", "anon") +
    v.kiAntworten * creditsFor("ai_generation", "anon") +
    v.uebersetzungen * creditsFor("ai_translation", "user");

  const jeAntwortUsd =
    (a.tokensInAntwort / 1e6) * p.llmInUsdProMTok +
    (a.tokensOutAntwort / 1e6) * p.llmOutUsdProMTok +
    (a.tokensFrage / 1e6) * p.embedUsdProMTok +
    (VECTOR_DIMENSIONS / 1e6) * p.vectorizeQueryUsdProMDim +
    (a.d1ReadsProFrage / 1e6) * p.d1ReadUsdProMRows +
    (a.d1WritesProFrage / 1e6) * p.d1WriteUsdProMRows;

  return {
    lines,
    variabelUsd,
    fixUsd,
    gesamtUsd,
    gesamtEur: gesamtUsd * p.eurProUsd,
    credits,
    creditsDeckelEmpfehlung: Math.max(1_000, Math.ceil((credits * 1.2) / 1_000) * 1_000),
    mauDeckelEmpfehlung: Math.max(100, Math.ceil((v.mau * 1.2) / 100) * 100),
    jeAntwortUsd,
    je1kCreditsEur: credits > 0 ? (variabelUsd / credits) * 1_000 * p.eurProUsd : null,
  };
}
