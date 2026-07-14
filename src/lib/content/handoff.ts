/*
  sessionStorage-Handoffs zwischen den Hilfezentrum-Ansichten (Startansicht ist
  Client-stateful, Artikelseiten sind SSR). Zentral hier, damit HelpShell und
  HelpCenter ohne zirkulären Import darauf zugreifen können.
*/

/** Frage von einer Artikelseite → Startansicht zeigt die (geerdete) Antwort. */
export const PENDING_ASK_KEY = "hh-pending-ask";

/** „Meine Artikel" auf einer Artikelseite → Startansicht öffnet diese gespeicherte Antwort (per ID). */
export const OPEN_ANSWER_KEY = "hh-open-answer";
