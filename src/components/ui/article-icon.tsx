import type { ReactElement } from "react";
import type { ArticleIcon as IconName } from "@/lib/content/article-icons";
import {
  BookmarkIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CodeIcon,
  CreditCardIcon,
  DocIcon,
  DownloadIcon,
  GridIcon,
  InboxIcon,
  InfoIcon,
  KeyIcon,
  LinkIcon,
  LockIcon,
  MegaphoneIcon,
  MicIcon,
  PencilIcon,
  PlayIcon,
  RoadmapIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  UserIcon,
  UserPlusIcon,
  WarnIcon,
} from "./icons";

/**
 * Name → Symbol. Die einzige Stelle, die den Katalog aus
 * `lib/content/article-icons.ts` mit React-Komponenten verbindet — dort steht
 * bewusst kein JSX, weil der Katalog auch serverseitig geprüft wird.
 */
type IconComponent = (props: { width?: number; height?: number; className?: string }) => ReactElement;

const ICONS: Record<IconName, IconComponent> = {
  doc: DocIcon,
  sparkle: SparkleIcon,
  info: InfoIcon,
  warn: WarnIcon,
  check: CheckCircleIcon,
  key: KeyIcon,
  lock: LockIcon,
  user: UserIcon,
  userPlus: UserPlusIcon,
  settings: SettingsIcon,
  chart: ChartBarIcon,
  code: CodeIcon,
  inbox: InboxIcon,
  card: CreditCardIcon,
  play: PlayIcon,
  link: LinkIcon,
  download: DownloadIcon,
  bookmark: BookmarkIcon,
  megaphone: MegaphoneIcon,
  roadmap: RoadmapIcon,
  grid: GridIcon,
  search: SearchIcon,
  mic: MicIcon,
  pencil: PencilIcon,
};

/**
 * Symbol eines Artikels. `null`/unbekannt → rendert NICHTS (der Standard ist
 * bewusst „kein Symbol"), niemals ein Platzhalter-Zeichen.
 *
 * Immer `aria-hidden`: Das Symbol wiederholt den daneben stehenden Titel und
 * hat keine eigene Bedeutung — eine Vorlesehilfe soll es überspringen.
 */
export function ArticleIconGlyph({
  name,
  size = 15,
  className,
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!name || !(name in ICONS)) return null;
  const Glyph = ICONS[name as IconName];
  return <span aria-hidden><Glyph width={size} height={size} className={className} /></span>;
}
