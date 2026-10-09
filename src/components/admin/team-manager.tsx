"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * TEAM-VERWALTUNG: Mitglieder, Rollen, Einladungen.
 *
 * Der Server kann das alles längst (api/team.ts) — es fehlte nur die Fläche.
 * Diese Oberfläche ruft die bestehenden Routen auf und erfindet keine eigenen
 * Regeln; sie SPIEGELT sie nur, damit niemand erst durch einen Fehlschlag
 * lernt, was er darf:
 *
 *  - ROLLEN-DECKEL: Zur Auswahl steht nur, was unter der eigenen Rolle liegt.
 *    Ein Admin vergibt `content`, Admin-Einladungen bleiben dem Owner
 *    vorbehalten. Der Server prüft das erneut — die Auswahl hier ist Ergonomie,
 *    keine Absicherung.
 *  - OWNER: taucht ohne Aktionen auf. Er lässt sich weder abstufen noch
 *    entfernen; wer den Besitz abgeben will, nimmt den Transfer-Weg.
 *  - SICH SELBST: ebenfalls ohne Aktionen — sonst sperrt sich jemand aus.
 *
 * ZWEI-FAKTOR steht als Spalte dabei, weil eine Team-Rolle ohne ihn gar nicht
 * wirksam wird: Heraufstufen parkt die Rolle, bis das Enrollment steht. Ohne
 * diese Spalte wunderte man sich, warum jemand „Redaktion" ist und trotzdem
 * nichts sieht.
 */

type Role = "user" | "content" | "admin" | "owner";

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  pendingRole: Role | null;
  twoFactorEnabled: boolean;
  createdAt: number;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: number;
}

const ROLE_LABELS: Record<string, MessageKey> = {
  owner: "admin.team.role.owner",
  admin: "admin.team.role.admin",
  content: "admin.team.role.content",
  user: "admin.team.role.user",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  owner_protected: "admin.team.error.ownerProtected",
  insufficient_rank: "admin.team.error.rank",
  cannot_change_self: "admin.team.error.self",
  cannot_remove_self: "admin.team.error.self",
  invalid_email: "admin.team.error.email",
  invitation_pending: "admin.team.error.pending",
  already_member: "admin.team.error.alreadyMember",
  // Diese drei fehlten: Jeder Zurückziehen-Fehler lief in die generische
  // Meldung, und man sah nie, WORAN es lag.
  invitation_not_pending: "admin.team.error.notPending",
  invitation_not_found: "admin.team.error.notFound",
  role_not_allowed: "admin.team.error.rank",
};

const RANKS: Record<string, number> = { user: 0, content: 1, admin: 2, owner: 3 };

export function TeamManager({ locale, viewerRole, viewerEmail }: {
  locale: Locale;
  viewerRole: Role;
  /**
   * „Ich selbst" wird über die E-Mail erkannt, nicht über eine Id: Der
   * Seiten-Viewer trägt keine Id, und die Adresse ist je Instanz durch einen
   * Unique-Index eindeutig (uq_user_tenant_email). Entscheidend ist das nur
   * für die Anzeige — der Server lehnt Selbst-Änderungen ohnehin ab.
   */
  viewerEmail: string;
}) {
  const t = getT(locale);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"content" | "admin">("content");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  /** Vergebbar ist nur, was STRIKT unter der eigenen Rolle liegt (wie im Server). */
  const assignable = (["content", "admin"] as const).filter(
    (r) => RANKS[viewerRole] > RANKS[r],
  );

  /** Abgelaufen — auch wenn die Zeile noch `pending` sagt (Ablauf wird erst
   *  beim Annahme-Versuch persistiert, nicht von einem Aufräum-Lauf). */
  const isDead = (inv: Invitation) =>
    inv.status === "expired" || inv.expiresAt * 1000 <= Date.now();

  /**
   * Die API liefert ALLE Einladungen, auch angenommene und zurückgezogene.
   * Unter „Offene Einladungen" gehören nur die, die noch eine Handlung
   * brauchen: offene und abgelaufene (letztere zum Wegräumen).
   */
  const openInvites = invites.filter(
    (inv) => inv.status === "pending" || inv.status === "expired",
  );

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([
        fetch("/api/v1/admin/team/members").then((r) => (r.ok ? r.json() : { members: [] })),
        fetch("/api/v1/admin/invitations").then((r) => (r.ok ? r.json() : { invitations: [] })),
      ]);
      setMembers((m as { members: Member[] }).members ?? []);
      setInvites((i as { invitations: Invitation[] }).invitations ?? []);
    } catch {
      setMembers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setErrorKey(null);
    try {
      const res = await fetch(url, init);
      if (res.ok) {
        await load();
        return true;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setErrorKey(ERROR_KEYS[data?.error ?? ""] ?? "admin.team.error.generic");
      return false;
    } catch {
      setErrorKey("admin.team.error.generic");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    const value = email.trim();
    if (value.length === 0) return;
    const ok = await call("/api/v1/admin/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: value, role: inviteRole }),
    });
    if (ok) {
      setSentTo(value);
      setEmail("");
    }
  }

  if (members === null) return <p className="text-sm text-ink-muted">…</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* ——— Einladen ——— */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("admin.team.inviteHeading")}</h3>
        <p className="text-xs text-ink-muted">
          {assignable.includes("admin")
            ? t("admin.team.inviteHintOwner")
            : t("admin.team.inviteHintAdmin")}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t("admin.team.email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("admin.team.emailPlaceholder")}
            className="min-w-[14rem] flex-1"
          />
          <div className="w-full min-w-[11rem] sm:w-48 sm:flex-none">
            <span className="mb-1 block text-xs text-ink-muted">{t("admin.team.role")}</span>
            <Select
              options={assignable.map((r) => ({ value: r, label: t(ROLE_LABELS[r]) }))}
              value={inviteRole}
              onValueChange={(v) => setInviteRole(v as "content" | "admin")}
              aria-label={t("admin.team.role")}
            />
          </div>
          <Button onClick={() => void invite()} disabled={busy}>
            {t("admin.team.invite")}
          </Button>
        </div>
        {sentTo ? (
          <p className="text-xs text-ok">{t("admin.team.invited", { email: sentTo })}</p>
        ) : null}
        {errorKey ? (
          <p className="text-xs text-crit" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
      </div>

      {/* ——— Offene Einladungen ——— */}
      {openInvites.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-hairline pt-5">
          <h3 className="text-sm font-medium">{t("admin.team.pendingHeading")}</h3>
          <ul className="flex flex-col gap-2">
            {openInvites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-ink">{inv.email}</span>
                <Badge tone="neutral">{t(ROLE_LABELS[inv.role] ?? "admin.team.role.content")}</Badge>
                {/* Abgelaufene bleiben sichtbar, aber als das, was sie sind —
                    sonst wartet man auf eine Annahme, die nie kommt. */}
                {isDead(inv) ? <Badge tone="warn">{t("admin.team.inviteExpired")}</Badge> : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() =>
                    void call(`/api/v1/admin/invitations/${inv.id}`, { method: "DELETE" })
                  }
                >
                  {t("admin.team.revoke")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ——— Mitglieder ——— */}
      <div className="flex flex-col gap-2 border-t border-hairline pt-5">
        <h3 className="text-sm font-medium">{t("admin.team.membersHeading")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.04em] text-ink-muted">
                <th className="py-2 pr-3 font-medium">{t("admin.team.member")}</th>
                <th className="py-2 pr-3 font-medium">{t("admin.team.role")}</th>
                <th className="py-2 pr-3 font-medium">{t("admin.team.mfa")}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.email.toLowerCase() === viewerEmail.toLowerCase();
                const isOwner = m.role === "owner";
                const mayAct = !isSelf && !isOwner && RANKS[viewerRole] > RANKS[m.role];
                return (
                  <tr key={m.id} className="border-b border-hairline last:border-b-0">
                    <td className="py-2.5 pr-3">
                      <span className="text-ink">{m.name || m.email}</span>
                      {m.name ? (
                        <span className="block text-xs text-ink-muted">{m.email}</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={isOwner ? "brand" : "neutral"}>
                          {t(ROLE_LABELS[m.role] ?? "admin.team.role.user")}
                        </Badge>
                        {/* Geparkte Rolle: vergeben, aber noch nicht wirksam. */}
                        {m.pendingRole ? (
                          <Badge tone="warn">
                            {t("admin.team.pendingRole", {
                              role: t(ROLE_LABELS[m.pendingRole] ?? "admin.team.role.content"),
                            })}
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-muted">
                      {m.twoFactorEnabled ? t("admin.team.mfaOn") : "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      {mayAct ? (
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          {assignable
                            .filter((r) => r !== m.role && r !== m.pendingRole)
                            .map((r) => (
                              <Button
                                key={r}
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  void call(`/api/v1/admin/team/members/${m.id}/role`, {
                                    method: "PUT",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ role: r }),
                                  })
                                }
                              >
                                {t("admin.team.makeRole", { role: t(ROLE_LABELS[r]) })}
                              </Button>
                            ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void call(`/api/v1/admin/team/members/${m.id}`, { method: "DELETE" })
                            }
                          >
                            {t("admin.team.remove")}
                          </Button>
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted">
                          {isOwner
                            ? t("admin.team.ownerNote")
                            : isSelf
                              ? t("admin.team.selfNote")
                              : null}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
