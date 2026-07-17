import { Hono } from "hono";
import { canonicalizeEmail } from "@product/server/auth/email";
import {
  generateInvitationToken,
  hashInvitationToken,
  D1InvitationRepository,
  INVITATION_TTL_SEC,
  type InvitationRole,
} from "@product/server/auth/invitations";
import { sendInvitationEmail } from "@product/server/auth/resend";
import { D1OperatorRepository, type NewHelpCenter } from "@product/server/operator/repository";
import { checkSlug } from "@product/server/operator/validate";
import { checkAccess, type OpsEnv } from "./access";
import {
  deleteTenant,
  parsePlanForm,
  PROTECTED_TENANT_ID,
  setPlan,
  suspendTenant,
  unsuspendTenant,
} from "./actions";
import {
  computeDealCosts,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PRICES,
  DEFAULT_VOLUMES,
  type DealAssumptions,
  type DealPrices,
  type DealVolumes,
} from "./costs";
import { listTenants, platformStats, tenantDetail } from "./queries";
import { PLAN_ORDER } from "@product/server/billing/pricing";
import { Bars, eur, fmtDate, Layout, nf, RoleBadge, StatusBadge, WIDGET_DEMO_URL } from "./ui";

/**
 * HALLOFHELP OPS — internes Betreiber-Dashboard (eigener Worker, Zugriff nur
 * über Cloudflare Access + JWT-Guard, s. access.ts). Aktionen nutzen die
 * GETESTETEN Produkt-Module über den @product-Alias (Provisioning,
 * Einladungen, Mail) — hier gibt es bewusst keine zweite Implementierung.
 */

type Ctx = { Bindings: OpsEnv; Variables: { email: string } };
const app = new Hono<Ctx>();

/** Basis-URL einer Instanz (repliziert tenantBaseURL aus auth/runtime —
 *  dort hängt better-auth dran, das der Ops-Worker nicht bundlen soll). */
const BASE_DOMAIN = "hallofhelp.com";
const tenantUrl = (slug: string) => `https://${slug}.${BASE_DOMAIN}`;

// Einladungs-TTLs kommen aus dem Produkt (INVITATION_TTL_SEC) — Rollen sind
// auf den Produkt-Vertrag beschränkt (InvitationRole: content | admin;
// „user" braucht keine Einladung, Registrierung ist offen).

// ——— Guard: ALLES hinter Access (fail-closed; Details access.ts) ————————
app.use("*", async (c, next) => {
  const result = await checkAccess(c.env, c.req.raw);
  if (!result.ok) {
    const status = result.reason === "unconfigured" ? 503 : 403;
    return c.text(
      result.reason === "unconfigured"
        ? "Ops ist noch nicht konfiguriert (ACCESS_TEAM_DOMAIN/ACCESS_AUD setzen)."
        : "Kein Zugriff.",
      status,
    );
  }
  c.set("email", result.email);
  return next();
});

// POST-Härtung: Formulare kommen ausschließlich same-origin.
app.use("*", async (c, next) => {
  if (c.req.method === "POST") {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== new URL(c.req.url).host) {
      return c.text("Ungültiger Origin.", 403);
    }
  }
  return next();
});

const nowSec = () => Math.floor(Date.now() / 1000);

// ——— Übersicht ————————————————————————————————————————————————————————
app.get("/", async (c) => {
  const now = nowSec();
  const [stats, tenants] = await Promise.all([
    platformStats(c.env.DB, now),
    listTenants(c.env.DB, now),
  ]);

  const ok = c.req.query("ok");
  return c.html(
    <Layout email={c.get("email")}>
      <h1>Plattform-Übersicht</h1>
      {ok === "deleted" ? <p class="note ok">Instanz endgültig gelöscht.</p> : null}
      <div class="grid">
        <div class="card kpi">
          <span>Instanzen</span>
          <b>{nf.format(stats.tenants)}</b>
        </div>
        <div class="card kpi">
          <span>Aktive Nutzer (Monat)</span>
          <b>{nf.format(stats.mauPeriod)}</b>
        </div>
        <div class="card kpi">
          <span>Credits (Monat)</span>
          <b>{nf.format(stats.creditsUsedPeriod)}</b>
        </div>
        <div class="card kpi">
          <span>Artikel-Aufrufe (30 T.)</span>
          <b>{nf.format(stats.views30)}</b>
        </div>
        <div class="card kpi">
          <span>KI-Antworten (30 T.)</span>
          <b>{nf.format(stats.generations30)}</b>
        </div>
        <div class="card kpi">
          <span>KI-Übersetzungen (30 T.)</span>
          <b>{nf.format(stats.translations30)}</b>
        </div>
        <div class="card kpi">
          <span>Offene Tickets</span>
          <b>{nf.format(stats.openTickets)}</b>
        </div>
      </div>

      <div class="row" style="margin-top:14px">
        <div class="card">
          <span class="muted" style="font-size:12.5px">
            Artikel-Aufrufe je Tag (30 Tage, alle Instanzen)
          </span>
          <Bars values={stats.series.views} />
        </div>
        <div class="card">
          <span class="muted" style="font-size:12.5px">
            KI-Antworten je Tag (30 Tage, alle Instanzen)
          </span>
          <Bars values={stats.series.generations} green />
        </div>
      </div>

      <h2>Instanzen</h2>
      <table>
        <thead>
          <tr>
            <th>Instanz</th>
            <th>Owner</th>
            <th>Plan</th>
            <th>Status</th>
            <th class="num">Credits (Monat)</th>
            <th class="num">MAU</th>
            <th class="num">Overage</th>
            <th class="num">Artikel</th>
            <th class="num">Tickets</th>
            <th>Erstellt</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr>
              <td>
                <a href={`/t/${t.id}`}>
                  <strong>{t.name}</strong>
                </a>
                <br />
                <span class="mono muted">{t.slug}</span>
              </td>
              <td>{t.ownerEmail ?? <span class="badge b-crit">kein Owner</span>}</td>
              <td>{t.state.plan.id}</td>
              <td>
                {t.suspendedAt ? (
                  <span class="badge b-crit">Blockiert</span>
                ) : (
                  <StatusBadge state={t.state} />
                )}
              </td>
              <td class="num">
                {nf.format(t.creditsUsed)}{" "}
                <span class="muted">/ {nf.format(t.state.plan.includedCredits)}</span>
              </td>
              <td class="num">{nf.format(t.mau)}</td>
              <td class="num">{t.overageCents > 0 ? eur.format(t.overageCents / 100) : "—"}</td>
              <td class="num">{nf.format(t.publishedArticles)}</td>
              <td class="num">{t.openTickets > 0 ? nf.format(t.openTickets) : "—"}</td>
              <td>{fmtDate(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>,
  );
});

// ——— Instanz-Detail ———————————————————————————————————————————————————
app.get("/t/:id", async (c) => {
  const detail = await tenantDetail(c.env.DB, c.req.param("id"), nowSec());
  if (!detail) return c.notFound();
  const { row } = detail;
  const ok = c.req.query("ok");
  const err = c.req.query("err");

  return c.html(
    <Layout email={c.get("email")}>
      <h1>
        {row.name} <span class="muted mono" style="font-size:14px">({row.slug})</span>
      </h1>
      {ok === "invited" ? <p class="note ok">Einladung angelegt und (falls Mail-Key gesetzt) versendet.</p> : null}
      {ok === "created" ? (
        <p class="note ok">
          Instanz angelegt. Owner-Zugang: „Passwort vergessen" auf{" "}
          <a href={`${tenantUrl(row.slug)}/forgot-password`}>{tenantUrl(row.slug)}/forgot-password</a>{" "}
          mit der Owner-E-Mail.
        </p>
      ) : null}
      {ok === "suspended" ? <p class="note ok">Instanz blockiert — sie ist ab sofort überall 404.</p> : null}
      {ok === "unsuspended" ? <p class="note ok">Instanz entsperrt — wieder erreichbar.</p> : null}
      {ok === "plan" ? <p class="note ok">Plan/Rahmen gespeichert — wirkt sofort in Enforcement und Kunden-Admin.</p> : null}
      {err ? <p class="note err">Aktion fehlgeschlagen: {err}</p> : null}
      {row.suspendedAt ? (
        <p class="note err">
          Diese Instanz ist BLOCKIERT (seit {fmtDate(row.suspendedAt)}) — Hilfezentrum, Admin und
          API antworten 404. Daten bleiben vollständig erhalten.
        </p>
      ) : null}

      <div class="row">
        <div class="card">
          <h2 style="margin-top:0">Stammdaten</h2>
          <dl>
            <dt>Öffentlich</dt>
            <dd>
              <a href={tenantUrl(row.slug)}>{tenantUrl(row.slug)}</a>
            </dd>
            <dt>Widget testen</dt>
            <dd>
              <a
                href={`${WIDGET_DEMO_URL}/?host=${row.slug}.${BASE_DOMAIN}`}
                target="_blank"
                rel="noopener"
              >
                auf der Demo-Endkundenseite öffnen ↗
              </a>
            </dd>
            <dt>Owner</dt>
            <dd>{row.ownerEmail ?? "— (kein Owner-Konto!)"}</dd>
            <dt>Sprache</dt>
            <dd>{detail.defaultLocale}</dd>
            <dt>SEO-Indexierung</dt>
            <dd>{detail.seoIndexable ? "an" : "aus"}</dd>
            <dt>Support-E-Mail</dt>
            <dd>{detail.supportEmail ?? "—"}</dd>
            <dt>Custom Domain</dt>
            <dd>
              {detail.customDomain
                ? `${detail.customDomain} (${detail.customDomainStatus ?? "unbekannt"})`
                : "—"}
            </dd>
            <dt>Erstellt</dt>
            <dd>{fmtDate(row.createdAt)}</dd>
            <dt>Artikel</dt>
            <dd>
              {nf.format(row.publishedArticles)} veröffentlicht · {nf.format(detail.draftArticles)}{" "}
              Entwürfe
            </dd>
          </dl>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Abo &amp; Nutzung</h2>
          <dl>
            <dt>Plan</dt>
            <dd>{row.state.plan.id}</dd>
            <dt>Status</dt>
            <dd>
              {row.suspendedAt ? (
                <span class="badge b-crit">Blockiert</span>
              ) : (
                <StatusBadge state={row.state} />
              )}
            </dd>
            <dt>Credits (Monat)</dt>
            <dd>
              {nf.format(row.creditsUsed)} / {nf.format(row.state.plan.includedCredits)}
            </dd>
            <dt>MAU (Monat)</dt>
            <dd>
              {nf.format(row.mau)} / {nf.format(row.state.plan.mauLimit)}
            </dd>
            <dt>Overage (Berechnung)</dt>
            <dd>{row.overageCents > 0 ? eur.format(row.overageCents / 100) : "—"}</dd>
            <dt>Offene Tickets</dt>
            <dd>{nf.format(row.openTickets)}</dd>
          </dl>
          <div style="margin-top:12px">
            <span class="muted" style="font-size:12.5px">Aufrufe je Tag (30 Tage)</span>
            <Bars values={detail.viewSeries} />
          </div>
          <p style="margin-top:12px;font-size:13px">
            <a
              href={`/kosten?ki=${detail.usage30.generations}&noans=0&uebers=${detail.usage30.translations}&views=${detail.usage30.views}&mau=${row.mau}&artikel=${row.publishedArticles}`}
            >
              → Selbstkosten mit diesen Zahlen kalkulieren (30-Tage-Basis)
            </a>
          </p>
        </div>
      </div>

      <h2>Nutzer ({detail.users.length})</h2>
      <table>
        <thead>
          <tr>
            <th>E-Mail</th>
            <th>Name</th>
            <th>Rolle</th>
            <th>Verifiziert</th>
            <th>2FA</th>
            <th>Erstellt</th>
          </tr>
        </thead>
        <tbody>
          {detail.users.map((u) => (
            <tr>
              <td>
                {u.email} {u.banned ? <span class="badge b-crit">gesperrt</span> : null}
              </td>
              <td>{u.name ?? "—"}</td>
              <td>
                <RoleBadge role={u.role} />
              </td>
              <td>{u.emailVerified ? "ja" : "nein"}</td>
              <td>{u.twoFactorEnabled ? "ja" : "nein"}</td>
              <td>{fmtDate(u.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Nutzer einladen</h2>
      <div class="card">
        <form class="inline" method="post" action={`/t/${row.id}/invite`}>
          <span>
            <label for="inv-email">E-Mail</label>
            <input id="inv-email" name="email" type="email" required placeholder="person@firma.de" />
          </span>
          <span>
            <label for="inv-role">Rolle</label>
            <select id="inv-role" name="role">
              <option value="content">content</option>
              <option value="admin">admin</option>
            </select>
          </span>
          <button type="submit">Einladen</button>
        </form>
        {detail.invitations.length > 0 ? (
          <table style="margin-top:12px">
            <thead>
              <tr>
                <th>Offene Einladung</th>
                <th>Rolle</th>
                <th>Läuft ab</th>
              </tr>
            </thead>
            <tbody>
              {detail.invitations.map((i) => (
                <tr>
                  <td>{i.email}</td>
                  <td>
                    <RoleBadge role={i.role} />
                  </td>
                  <td>{fmtDate(i.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <h2>Verwaltung</h2>
      {row.id === PROTECTED_TENANT_ID ? (
        <div class="card">
          <span class="muted">
            Betreiber-Instanz (t_operator) — Blockieren und Löschen sind hier dauerhaft gesperrt.
            Plan/Rahmen lassen sich anpassen.
          </span>
        </div>
      ) : null}

      <div class="row">
        <div class="card">
          <h2 style="margin-top:0">Plan &amp; Rahmen</h2>
          <form class="inline" method="post" action={`/t/${row.id}/plan`}>
            <span>
              <label for="p-plan">Plan</label>
              <select id="p-plan" name="plan">
                {PLAN_ORDER.map((p) => (
                  <option value={p} selected={p === row.state.plan.id}>
                    {p}
                  </option>
                ))}
              </select>
            </span>
            <span>
              <label for="p-credits">Credits-Deckel (nur Enterprise)</label>
              <input
                id="p-credits"
                name="customIncludedCredits"
                type="number"
                min="1"
                placeholder="Plan-Standard"
                value={row.state.plan.id === "enterprise" ? String(row.state.plan.includedCredits) : ""}
              />
            </span>
            <span>
              <label for="p-mau">MAU-Deckel (nur Enterprise)</label>
              <input
                id="p-mau"
                name="customMauLimit"
                type="number"
                min="1"
                placeholder="Plan-Standard"
                value={row.state.plan.id === "enterprise" ? String(row.state.plan.mauLimit) : ""}
              />
            </span>
            <button type="submit">Speichern</button>
          </form>
          <p class="muted" style="font-size:12.5px;margin-top:10px">
            Leer = Standardwerte des Plans. Der Rahmen wirkt sofort überall: Limit-Prüfung
            (Kulanz/Freeze), Kunden-Admin und diese Übersicht rechnen mit denselben Werten.
          </p>
        </div>

        {row.id !== PROTECTED_TENANT_ID ? (
          <div class="card">
            <h2 style="margin-top:0">Gefahrenzone</h2>
            {row.suspendedAt ? (
              <>
                <form method="post" action={`/t/${row.id}/unsuspend`} style="margin-bottom:14px">
                  <button type="submit">Entsperren</button>
                </form>
                <p class="muted" style="font-size:12.5px">
                  Endgültig löschen: entfernt ALLE Daten der Instanz (Artikel, Nutzer, Nutzung,
                  Bilder, Such-Index). Zur Bestätigung den Slug <span class="mono">{row.slug}</span>{" "}
                  exakt eintippen.
                </p>
                <form class="inline" method="post" action={`/t/${row.id}/delete`}>
                  <span>
                    <label for="d-confirm">Slug zur Bestätigung</label>
                    <input id="d-confirm" name="confirmSlug" placeholder={row.slug} autocomplete="off" />
                  </span>
                  <button type="submit" style="background:var(--crit)">
                    Endgültig löschen
                  </button>
                </form>
              </>
            ) : (
              <>
                <p class="muted" style="font-size:12.5px">
                  Blockieren nimmt die Instanz sofort überall vom Netz (404) — Daten bleiben
                  erhalten, Entsperren macht alles rückgängig. Löschen ist erst NACH dem
                  Blockieren möglich (Zwei-Schritt-Schutz).
                </p>
                <form method="post" action={`/t/${row.id}/suspend`}>
                  <button type="submit" style="background:var(--warn)">
                    Instanz blockieren
                  </button>
                </form>
              </>
            )}
          </div>
        ) : null}
      </div>

      {detail.recentTickets.length > 0 ? (
        <>
          <h2>Letzte Support-Tickets</h2>
          <table>
            <thead>
              <tr>
                <th>Nachricht</th>
                <th>Status</th>
                <th>Erstellt</th>
              </tr>
            </thead>
            <tbody>
              {detail.recentTickets.map((tk) => (
                <tr>
                  <td>{tk.message.slice(0, 140)}</td>
                  <td>
                    <span class={`badge ${tk.status === "open" ? "b-warn" : "b-mut"}`}>{tk.status}</span>
                  </td>
                  <td>{fmtDate(tk.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Layout>,
  );
});

// ——— Aktion: Nutzer einladen (nutzt Produkt-Repos + Produkt-Mail) —————————
app.post("/t/:id/invite", async (c) => {
  const tenantId = c.req.param("id");
  const form = await c.req.parseBody();
  const email = typeof form.email === "string" ? canonicalizeEmail(form.email) : "";
  const role: InvitationRole = form.role === "admin" ? "admin" : "content";
  const back = (q: string) => c.redirect(`/t/${tenantId}?${q}`, 303);

  if (!email.includes("@")) return back("err=email");

  const tenant = await c.env.DB.prepare(`SELECT id, slug, name FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first<{ id: string; slug: string; name: string }>();
  if (!tenant) return c.notFound();

  // Bereits Mitglied? (Instanz-Konten sind je Tenant eindeutig per E-Mail.)
  const member = await c.env.DB.prepare(
    `SELECT id FROM auth_user WHERE tenant_id = ? AND email = ?`,
  )
    .bind(tenantId, email)
    .first();
  if (member) return back("err=bereits-mitglied");

  const invitations = new D1InvitationRepository(c.env.DB);
  if (await invitations.findPendingByEmail(tenantId, email)) return back("err=bereits-eingeladen");

  // inviter_id hat einen FK auf auth_user → Einladung läuft im Namen des
  // Owner-Kontos der Instanz (Ops-Identität steht im Access-Log).
  const owner = await c.env.DB.prepare(
    `SELECT id FROM auth_user WHERE tenant_id = ? AND role = 'owner' LIMIT 1`,
  )
    .bind(tenantId)
    .first<{ id: string }>();
  if (!owner) return back("err=kein-owner");

  const token = generateInvitationToken();
  await invitations.create({
    id: crypto.randomUUID(),
    tenantId,
    email,
    role,
    tokenHash: await hashInvitationToken(token),
    inviterId: owner.id,
    expiresAt: nowSec() + INVITATION_TTL_SEC[role],
  });

  // Accept-Link exakt wie im Produkt (team.ts) — Token nur in der Mail.
  const acceptUrl = `${tenantUrl(tenant.slug)}/invite/accept?token=${token}`;
  try {
    await sendInvitationEmail(c.env, { to: email, acceptUrl, role, tenantName: tenant.name });
  } catch (err) {
    console.error("[ops] Einladungs-Mail fehlgeschlagen:", err);
    return back("err=mailversand");
  }
  return back("ok=invited");
});

// ——— Aktionen: Blockieren / Entsperren / Plan / Löschen ————————————————
app.post("/t/:id/suspend", async (c) => {
  const id = c.req.param("id");
  const result = await suspendTenant(c.env.DB, id, nowSec());
  if (result === "protected") return c.redirect(`/t/${id}?err=geschuetzt`, 303);
  if (result === "not_found") return c.redirect(`/t/${id}?err=nicht-gefunden`, 303);
  return c.redirect(`/t/${id}?ok=suspended`, 303);
});

app.post("/t/:id/unsuspend", async (c) => {
  const id = c.req.param("id");
  const result = await unsuspendTenant(c.env.DB, id);
  return c.redirect(`/t/${id}?${result === "ok" ? "ok=unsuspended" : "err=nicht-gefunden"}`, 303);
});

app.post("/t/:id/plan", async (c) => {
  const id = c.req.param("id");
  const parsed = parsePlanForm(await c.req.parseBody());
  if (!parsed) return c.redirect(`/t/${id}?err=plan-eingaben`, 303);
  const result = await setPlan(c.env.DB, { ...parsed, tenantId: id });
  return c.redirect(`/t/${id}?${result === "ok" ? "ok=plan" : "err=nicht-gefunden"}`, 303);
});

/**
 * ENDGÜLTIG löschen — starke Verifizierung in drei Schichten:
 * (1) nur BLOCKIERTE Instanzen (Zwei-Schritt, s. actions.ts),
 * (2) exakter Slug muss eingetippt werden,
 * (3) t_operator ist hart geschützt.
 */
app.post("/t/:id/delete", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();

  const tenant = await c.env.DB.prepare(`SELECT slug FROM tenants WHERE id = ?`)
    .bind(id)
    .first<{ slug: string }>();
  if (!tenant) return c.notFound();
  if (typeof form.confirmSlug !== "string" || form.confirmSlug.trim() !== tenant.slug) {
    return c.redirect(`/t/${id}?err=slug-bestaetigung`, 303);
  }

  const result = await deleteTenant(c.env, id);
  if (result === "protected") return c.redirect(`/t/${id}?err=geschuetzt`, 303);
  if (result === "invalid") return c.redirect(`/t/${id}?err=erst-blockieren`, 303);
  if (result === "not_found") return c.notFound();

  console.log(`[ops] Instanz ${id} (${tenant.slug}) gelöscht von ${c.get("email")}`);
  return c.redirect("/?ok=deleted", 303);
});

// ——— Selbstkostenrechner ——————————————————————————————————————————————
const numParam = (get: (k: string) => string | undefined, key: string, dflt: number): number => {
  const raw = get(key);
  if (raw == null || raw.trim() === "") return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

/** USD mit bis zu 4 Nachkommastellen — Cent-Beträge (Embeddings!) sonst = 0. */
const usd = (v: number) =>
  `$${v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

function NumField({ k, label, value, hint }: { k: string; label: string; value: number; hint?: string }) {
  return (
    <span style="max-width:170px">
      <label for={`f-${k}`}>{label}</label>
      <input id={`f-${k}`} name={k} type="number" min="0" step="any" value={String(value)} style="width:100%" />
      {hint ? <span class="muted" style="display:block;font-size:11px;margin-top:2px">{hint}</span> : null}
    </span>
  );
}

app.get("/kosten", (c) => {
  const q = (k: string) => c.req.query(k);
  const v: DealVolumes = {
    kiAntworten: numParam(q, "ki", DEFAULT_VOLUMES.kiAntworten),
    kiOhneAntwort: numParam(q, "noans", DEFAULT_VOLUMES.kiOhneAntwort),
    uebersetzungen: numParam(q, "uebers", DEFAULT_VOLUMES.uebersetzungen),
    views: numParam(q, "views", DEFAULT_VOLUMES.views),
    mau: numParam(q, "mau", DEFAULT_VOLUMES.mau),
    artikel: numParam(q, "artikel", DEFAULT_VOLUMES.artikel),
  };
  const a: DealAssumptions = {
    tokensInAntwort: numParam(q, "tokIn", DEFAULT_ASSUMPTIONS.tokensInAntwort),
    tokensOutAntwort: numParam(q, "tokOut", DEFAULT_ASSUMPTIONS.tokensOutAntwort),
    tokensInUebersetzung: numParam(q, "tokTin", DEFAULT_ASSUMPTIONS.tokensInUebersetzung),
    tokensOutUebersetzung: numParam(q, "tokTout", DEFAULT_ASSUMPTIONS.tokensOutUebersetzung),
    tokensFrage: numParam(q, "tokFrage", DEFAULT_ASSUMPTIONS.tokensFrage),
    tokensChunk: numParam(q, "tokChunk", DEFAULT_ASSUMPTIONS.tokensChunk),
    chunksProArtikel: numParam(q, "chunks", DEFAULT_ASSUMPTIONS.chunksProArtikel),
    reindexProMonat: numParam(q, "reindex", DEFAULT_ASSUMPTIONS.reindexProMonat),
    d1ReadsProView: numParam(q, "d1rv", DEFAULT_ASSUMPTIONS.d1ReadsProView),
    d1WritesProView: numParam(q, "d1wv", DEFAULT_ASSUMPTIONS.d1WritesProView),
    d1ReadsProFrage: numParam(q, "d1rf", DEFAULT_ASSUMPTIONS.d1ReadsProFrage),
    d1WritesProFrage: numParam(q, "d1wf", DEFAULT_ASSUMPTIONS.d1WritesProFrage),
  };
  const p: DealPrices = {
    llmInUsdProMTok: numParam(q, "pLlmIn", DEFAULT_PRICES.llmInUsdProMTok),
    llmOutUsdProMTok: numParam(q, "pLlmOut", DEFAULT_PRICES.llmOutUsdProMTok),
    embedUsdProMTok: numParam(q, "pEmb", DEFAULT_PRICES.embedUsdProMTok),
    vectorizeQueryUsdProMDim: numParam(q, "pVecQ", DEFAULT_PRICES.vectorizeQueryUsdProMDim),
    vectorizeStorageUsdPro100MDim: numParam(q, "pVecS", DEFAULT_PRICES.vectorizeStorageUsdPro100MDim),
    d1ReadUsdProMRows: numParam(q, "pD1r", DEFAULT_PRICES.d1ReadUsdProMRows),
    d1WriteUsdProMRows: numParam(q, "pD1w", DEFAULT_PRICES.d1WriteUsdProMRows),
    fixkostenUsdMonat: numParam(q, "fix", DEFAULT_PRICES.fixkostenUsdMonat),
    sonstigesUsdMonat: numParam(q, "sonst", DEFAULT_PRICES.sonstigesUsdMonat),
    eurProUsd: numParam(q, "kurs", DEFAULT_PRICES.eurProUsd),
  };
  const dealEur = numParam(q, "dealEur", 0);

  const r = computeDealCosts(v, a, p);
  const margeEur = dealEur > 0 ? dealEur - r.gesamtEur : null;

  return c.html(
    <Layout email={c.get("email")}>
      <h1>Selbstkostenrechner</h1>
      <p class="muted" style="font-size:13.5px;margin-bottom:16px">
        Monatliche Selbstkosten eines individuellen Deals aus dem erwarteten Nutzungs-Mix.
        Preise = Cloudflare-<strong>Listenpreise</strong> (Stand 2026-07), bewusst konservativ:
        Freikontingente (50M Vectorize-Dims, 25Mrd/50M D1-Reads/Writes …) sind NICHT abgezogen.
        Token-Annahmen mit echten Werten aus den AI-Gateway-Logs kalibrieren.
      </p>

      <form method="get" action="/kosten">
        <div class="card" style="margin-bottom:12px">
          <h2 style="margin-top:0">Volumen pro Monat</h2>
          <div class="inline" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start">
            <NumField k="ki" label="KI-Antworten" value={v.kiAntworten} />
            <NumField k="noans" label="KI-Fragen ohne Antwort" value={v.kiOhneAntwort} hint="kosten Embedding/Suche, aber 0 Credits" />
            <NumField k="uebers" label="KI-Übersetzungen" value={v.uebersetzungen} />
            <NumField k="views" label="Artikel-Aufrufe" value={v.views} />
            <NumField k="mau" label="MAU" value={v.mau} />
            <NumField k="artikel" label="Artikel (Bestand)" value={v.artikel} />
            <NumField k="dealEur" label="Deal-Preis €/Monat (optional)" value={dealEur} hint="für die Margen-Anzeige" />
          </div>
        </div>

        <details style="margin-bottom:12px">
          <summary style="cursor:pointer;font-weight:600;font-size:14px;padding:6px 2px">Annahmen (Tokens &amp; D1-Zeilen je Vorgang)</summary>
          <div class="card" style="margin-top:8px">
            <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start">
              <NumField k="tokIn" label="Tokens rein je Antwort" value={a.tokensInAntwort} hint="System-Prompt + 6 Kontext-Chunks + Frage" />
              <NumField k="tokOut" label="Tokens raus je Antwort" value={a.tokensOutAntwort} />
              <NumField k="tokTin" label="Tokens rein je Übersetzung" value={a.tokensInUebersetzung} />
              <NumField k="tokTout" label="Tokens raus je Übersetzung" value={a.tokensOutUebersetzung} />
              <NumField k="tokFrage" label="Embedding-Tokens je Frage" value={a.tokensFrage} />
              <NumField k="tokChunk" label="Tokens je Chunk" value={a.tokensChunk} />
              <NumField k="chunks" label="Chunks je Artikel" value={a.chunksProArtikel} />
              <NumField k="reindex" label="Neuindexierungen/Monat" value={a.reindexProMonat} hint="wie oft der Bestand re-published wird" />
              <NumField k="d1rv" label="D1-Reads je View" value={a.d1ReadsProView} />
              <NumField k="d1wv" label="D1-Writes je View" value={a.d1WritesProView} />
              <NumField k="d1rf" label="D1-Reads je Frage" value={a.d1ReadsProFrage} />
              <NumField k="d1wf" label="D1-Writes je Frage" value={a.d1WritesProFrage} />
            </div>
          </div>
        </details>

        <details style="margin-bottom:12px">
          <summary style="cursor:pointer;font-weight:600;font-size:14px;padding:6px 2px">Preise (USD, Cloudflare-Listenpreise)</summary>
          <div class="card" style="margin-top:8px">
            <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start">
              <NumField k="pLlmIn" label="LLM $/M Tokens rein" value={p.llmInUsdProMTok} hint="llama-3.3-70b fp8-fast" />
              <NumField k="pLlmOut" label="LLM $/M Tokens raus" value={p.llmOutUsdProMTok} />
              <NumField k="pEmb" label="Embeddings $/M Tokens" value={p.embedUsdProMTok} hint="bge-m3" />
              <NumField k="pVecQ" label="Vectorize $/M Query-Dims" value={p.vectorizeQueryUsdProMDim} />
              <NumField k="pVecS" label="Vectorize $/100M Speicher-Dims" value={p.vectorizeStorageUsdPro100MDim} />
              <NumField k="pD1r" label="D1 $/M Reads" value={p.d1ReadUsdProMRows} />
              <NumField k="pD1w" label="D1 $/M Writes" value={p.d1WriteUsdProMRows} />
              <NumField k="fix" label="Fixkosten $/Monat" value={p.fixkostenUsdMonat} hint="Workers Paid + Grundrauschen, anteilig" />
              <NumField k="sonst" label="Sonstiges $/Monat" value={p.sonstigesUsdMonat} hint="R2-Ops, Mails, CPU — bei Bedarf" />
              <NumField k="kurs" label="EUR je USD" value={p.eurProUsd} />
            </div>
          </div>
        </details>

        <button type="submit">Berechnen</button>{" "}
        <a href="/kosten" style="margin-left:10px;font-size:13.5px">Zurücksetzen</a>
      </form>

      <h2>Ergebnis</h2>
      <div class="grid">
        <div class="card kpi">
          <span>Selbstkosten gesamt/Monat</span>
          <b>{eur.format(r.gesamtEur)}</b>
          <span class="muted">{usd(r.gesamtUsd)} · davon variabel {usd(r.variabelUsd)}</span>
        </div>
        <div class="card kpi">
          <span>Credits, die der Mix verbraucht</span>
          <b>{nf.format(r.credits)}</b>
          <span class="muted">Produkt-Preisregel (Views 1 · Antwort 20 · Übersetzung 50)</span>
        </div>
        <div class="card kpi">
          <span>Variable Kosten je 1.000 Credits</span>
          <b>{r.je1kCreditsEur !== null ? eur.format(r.je1kCreditsEur) : "—"}</b>
        </div>
        <div class="card kpi">
          <span>Grenzkosten je KI-Antwort</span>
          <b>{(r.jeAntwortUsd * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} US-Cent</b>
        </div>
        {margeEur !== null ? (
          <div class="card kpi">
            <span>Marge bei {eur.format(dealEur)}/Monat</span>
            <b style={margeEur >= 0 ? "color:var(--ok)" : "color:var(--crit)"}>
              {eur.format(margeEur)}
            </b>
            <span class="muted">{((margeEur / dealEur) * 100).toFixed(1)} % vom Deal-Preis</span>
          </div>
        ) : null}
      </div>

      <h2>Kostentreiber</h2>
      <table>
        <thead>
          <tr>
            <th>Posten</th>
            <th>Menge</th>
            <th class="num">USD/Monat</th>
            <th class="num">EUR/Monat</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr>
              <td>{l.label}</td>
              <td class="muted">{l.detail}</td>
              <td class="num">{usd(l.usd)}</td>
              <td class="num">{eur.format(l.usd * p.eurProUsd)}</td>
            </tr>
          ))}
          <tr>
            <td>Sonstiges (Pauschale)</td>
            <td class="muted">—</td>
            <td class="num">{usd(p.sonstigesUsdMonat)}</td>
            <td class="num">{eur.format(p.sonstigesUsdMonat * p.eurProUsd)}</td>
          </tr>
          <tr>
            <td><strong>Fixkosten</strong></td>
            <td class="muted">Workers Paid + Grundrauschen</td>
            <td class="num">{usd(r.fixUsd)}</td>
            <td class="num">{eur.format(r.fixUsd * p.eurProUsd)}</td>
          </tr>
        </tbody>
      </table>

      <h2>Empfehlung für den Enterprise-Rahmen</h2>
      <div class="card">
        <dl>
          <dt>Credits-Deckel (custom_included_credits)</dt>
          <dd>
            <strong>{nf.format(r.creditsDeckelEmpfehlung)}</strong>{" "}
            <span class="muted">= Verbrauch {nf.format(r.credits)} + 20 % Puffer, auf 1.000 gerundet</span>
          </dd>
          <dt>MAU-Deckel (custom_mau_limit)</dt>
          <dd>
            <strong>{nf.format(r.mauDeckelEmpfehlung)}</strong>{" "}
            <span class="muted">= MAU {nf.format(v.mau)} + 20 % Puffer, auf 100 gerundet</span>
          </dd>
        </dl>
        <p class="muted" style="font-size:12.5px;margin-top:10px">
          Eintragen auf der Instanz-Detailseite unter „Plan &amp; Rahmen" (Plan: enterprise).
        </p>
      </div>
    </Layout>,
  );
});

// ——— Neue Instanz ————————————————————————————————————————————————————
app.get("/new", (c) => {
  const err = c.req.query("err");
  return c.html(
    <Layout email={c.get("email")}>
      <h1>Neue Instanz erstellen</h1>
      {err ? <p class="note err">Fehlgeschlagen: {err}</p> : null}
      <div class="card" style="max-width:560px">
        <form method="post" action="/new" style="display:flex;flex-direction:column;gap:12px">
          <span>
            <label for="n-name">Name</label>
            <input id="n-name" name="name" required placeholder="Acme Support" style="width:100%" />
          </span>
          <span>
            <label for="n-slug">Subdomain (Slug)</label>
            <input id="n-slug" name="slug" required placeholder="acme" style="width:100%" />
            <span class="muted" style="font-size:12px">→ acme.{BASE_DOMAIN}</span>
          </span>
          <span>
            <label for="n-owner">Owner-E-Mail</label>
            <input id="n-owner" name="ownerEmail" type="email" required placeholder="owner@firma.de" style="width:100%" />
          </span>
          <span>
            <label for="n-seo" style="display:flex;gap:8px;align-items:center;font-size:14px;color:var(--ink)">
              <input id="n-seo" name="seoIndexable" type="checkbox" checked /> Suchmaschinen-Indexierung aktiv
            </label>
          </span>
          <span>
            <label for="n-locale">Sprache</label>
            <select id="n-locale" name="locale">
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </span>
          <span>
            <button type="submit">Instanz anlegen</button>
          </span>
          <span class="muted" style="font-size:12.5px">
            Es wird ein Owner-Konto mit dieser E-Mail angelegt (verifiziert, ohne Passwort). Zugang
            holt sich der Owner über „Passwort vergessen" auf der neuen Instanz.
          </span>
        </form>
      </div>
    </Layout>,
  );
});

app.post("/new", async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === "string" ? form.name.trim() : "";
  const slug = typeof form.slug === "string" ? form.slug.trim().toLowerCase() : "";
  const ownerEmail = typeof form.ownerEmail === "string" ? canonicalizeEmail(form.ownerEmail) : "";
  const locale = form.locale === "en" ? "en" : "de";

  if (name.length < 2) return c.redirect("/new?err=name", 303);
  if (!ownerEmail.includes("@")) return c.redirect("/new?err=owner-email", 303);
  const slugProblem = checkSlug(slug);
  if (slugProblem) return c.redirect(`/new?err=slug-${slugProblem}`, 303);

  const repo = new D1OperatorRepository(c.env.DB);
  if (await repo.isSlugTaken(slug)) return c.redirect("/new?err=slug-taken", 303);

  const input: NewHelpCenter = {
    tenantId: `t_${crypto.randomUUID()}`,
    slug,
    name,
    defaultLocale: locale,
    colorPrimary: "#4f46e5",
    colorAccent: "#06b6d4",
    // Ops-erstellte Instanzen gehören keinem Console-Konto — der Sentinel
    // taucht in keiner „Meine Hilfezentren"-Liste auf.
    operatorUserId: "ops:managed",
    ownerUserId: crypto.randomUUID(),
    ownerEmail,
    ownerName: null,
    seoIndexable: form.seoIndexable === "on",
    // Kein Zugangsdaten-Kopieren aus Ops (das macht nur der Console-Flow des
    // Owners selbst) — Zugang via „Passwort vergessen" auf der neuen Instanz.
    ownerCredential: null,
  };
  const result = await repo.createHelpCenter(input);
  if (result === "slug_taken") return c.redirect("/new?err=slug-taken", 303);

  return c.redirect(`/t/${input.tenantId}?ok=created`, 303);
});

export default app;
