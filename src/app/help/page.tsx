import { permanentRedirect } from "next/navigation";

/**
 * `/help` ist historisch (das Hilfezentrum lag früher hier). Es lebt jetzt unter
 * der Tenant-Root `/`. Permanenter (308) Redirect erhält alte Links/Bookmarks
 * und gibt Suchmaschinen das korrekte Signal.
 */
export default function HelpRedirect(): never {
  permanentRedirect("/");
}
