import { Button } from "@/components/ui/button";
import { DocIcon } from "@/components/ui/icons";

/** Visueller Platzhalter für den Logo-Upload (Funktion folgt). Server-sicher. */
export function UploadPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 rounded-card border border-dashed border-hairline-strong bg-tint px-5 py-5">
      <span className="grid h-12 w-12 place-items-center rounded-comfy border border-hairline bg-surface text-ink-muted">
        <DocIcon width={20} height={20} />
      </span>
      <Button variant="cream" size="sm">
        {label}
      </Button>
    </div>
  );
}
