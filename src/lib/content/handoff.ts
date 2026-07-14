/*
  sessionStorage-Handoffs zwischen den Hilfezentrum-Ansichten (Startansicht ist
  Client-stateful, Artikelseiten sind SSR). Zentral hier, damit HelpShell und
  HelpCenter ohne zirkulären Import darauf zugreifen können.
*/

/** Frage von einer Artikelseite → Startansicht zeigt die (geerdete) Antwort. */
export const PENDING_ASK_KEY = "hh-pending-ask";

/** Sidebar „Gespeicherte Artikel" → Startansicht öffnet die Gespeichert-Liste. */
export const OPEN_SAVED_KEY = "hh-open-saved";
