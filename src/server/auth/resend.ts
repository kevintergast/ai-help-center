/**
 * E-Mail-Versand via Resend (HTTP-API). Bewusst dependency-frei (globales
 * `fetch`), damit es im Worker- wie im Node-/Test-Kontext identisch läuft.
 *
 * INERT OHNE KEY: fehlt `RESEND_API_KEY`, ist der Versand ein sauberes No-op
 * (einmaliges `console.warn`, KEIN throw) — dev/Tests laufen ohne Konfiguration.
 * Ein tatsächlicher API-Fehler (Key vorhanden, Resend antwortet != 2xx) wirft
 * hingegen, damit echte Zustellprobleme nicht still verschluckt werden.
 * Es werden KEINE Keys geloggt.
 */

type ResendEnv = { RESEND_API_KEY?: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Absender-Default (kein Secret). Überschreibbar via `createEmailSenders(env,{from})`. */
const DEFAULT_FROM = "HallofHelp <noreply@hallofhelp.com>";

/** Prozessweit nur EIN Hinweis, wenn kein Key gesetzt ist (kein Log-Spam). */
let missingKeyWarned = false;

/** @internal — nur für Tests, setzt die einmalige Warn-Sperre zurück. */
export function __resetResendWarningForTests(): void {
  missingKeyWarned = false;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Optionaler Absender; sonst {@link DEFAULT_FROM}. */
  from?: string;
}

/**
 * Sendet eine E-Mail über Resend.
 * @returns `true`, wenn tatsächlich gesendet wurde; `false` beim No-op (kein Key).
 * @throws wenn ein Key gesetzt ist, der Resend-Call aber fehlschlägt.
 */
export async function sendEmail(env: ResendEnv, msg: EmailMessage): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    if (!missingKeyWarned) {
      missingKeyWarned = true;
      console.warn(
        "[auth/resend] RESEND_API_KEY nicht gesetzt — E-Mail-Versand ist deaktiviert (No-op).",
      );
    }
    return false;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: msg.from ?? DEFAULT_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend-Versand fehlgeschlagen (HTTP ${res.status}): ${detail}`);
  }
  return true;
}

/** Minimaler User-Ausschnitt, den die better-auth-Callbacks liefern. */
interface EmailUser {
  email: string;
  name?: string | null;
}

interface EmailCallbackData {
  user: EmailUser;
  url: string;
  token: string;
}

function actionEmailHtml(headline: string, intro: string, cta: string, url: string): string {
  return [
    `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">`,
    `<h1 style="font-size:20px">${headline}</h1>`,
    `<p>${intro}</p>`,
    `<p><a href="${url}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#4f46e5;color:#fff;text-decoration:none">${cta}</a></p>`,
    `<p style="font-size:12px;color:#666">Falls der Button nicht funktioniert: ${url}</p>`,
    `</div>`,
  ].join("");
}

/** Daten der Team-Einladungs-Mail (Phase D, Design §c.4). */
export interface InvitationEmailData {
  to: string;
  /** Accept-Link auf dem KANONISCHEN Tenant-Host — trägt das Roh-Token. */
  acceptUrl: string;
  role: string;
  tenantName: string;
}

/**
 * Sendet die Team-Einladung. Das Roh-Token steckt NUR im `acceptUrl` dieses
 * Mail-Bodys — es wird nie geloggt und nie in einer API-Antwort ausgegeben
 * (dev-Ausnahme siehe Invitations-Route: `devAcceptUrl` ohne konfigurierten Key).
 * @returns `true` = wirklich versendet; `false` = No-op (kein RESEND_API_KEY).
 */
export async function sendInvitationEmail(
  env: ResendEnv,
  data: InvitationEmailData,
): Promise<boolean> {
  return sendEmail(env, {
    to: data.to,
    subject: `Einladung ins Team von ${data.tenantName}`,
    html: actionEmailHtml(
      "Team-Einladung",
      `Du wurdest eingeladen, dem Team von ${data.tenantName} beizutreten (Rolle: ${data.role}). ` +
        `Der Link ist nur begrenzt gültig. Falls du diese Einladung nicht erwartest, ignoriere diese E-Mail.`,
      "Einladung annehmen",
      data.acceptUrl,
    ),
  });
}

/** Daten des Email-OTP-Callbacks (two-factor-Plugin, `otpOptions.sendOTP`). */
interface OtpCallbackData {
  user: EmailUser;
  otp: string;
}

function otpEmailHtml(code: string): string {
  return [
    `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">`,
    `<h1 style="font-size:20px">Dein Anmeldecode</h1>`,
    `<p>Gib diesen Code ein, um die Anmeldung abzuschließen. Er ist nur kurz gültig.</p>`,
    `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>`,
    `<p style="font-size:12px;color:#666">Falls du das nicht warst, ignoriere diese E-Mail und ändere dein Passwort.</p>`,
    `</div>`,
  ].join("");
}

/**
 * Baut die better-auth-E-Mail-Callbacks (`sendVerificationEmail`,
 * `sendResetPassword`, `sendOtpEmail` für den Email-OTP-Zweitfaktor).
 * Ohne Key sind alle inert (siehe {@link sendEmail}).
 */
export function createEmailSenders(env: ResendEnv, opts?: { from?: string }): {
  sendVerificationEmail: (data: EmailCallbackData) => Promise<void>;
  sendResetPassword: (data: EmailCallbackData) => Promise<void>;
  sendOtpEmail: (data: OtpCallbackData) => Promise<void>;
} {
  const from = opts?.from;
  return {
    // Email-OTP als 2. Faktor (Phase C; per Policy nur für content erlaubt).
    // Der Code steht NUR im Mail-Body — nie in Logs.
    sendOtpEmail: async ({ user, otp }: OtpCallbackData): Promise<void> => {
      await sendEmail(env, {
        to: user.email,
        from,
        subject: "Dein Anmeldecode",
        html: otpEmailHtml(otp),
      });
    },
    sendVerificationEmail: async ({ user, url }: EmailCallbackData): Promise<void> => {
      await sendEmail(env, {
        to: user.email,
        from,
        subject: "Bestätige deine E-Mail-Adresse",
        html: actionEmailHtml(
          "E-Mail bestätigen",
          "Bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren.",
          "E-Mail bestätigen",
          url,
        ),
      });
    },
    sendResetPassword: async ({ user, url }: EmailCallbackData): Promise<void> => {
      await sendEmail(env, {
        to: user.email,
        from,
        subject: "Passwort zurücksetzen",
        html: actionEmailHtml(
          "Passwort zurücksetzen",
          "Setze dein Passwort über den folgenden Link zurück. Ignoriere diese E-Mail, falls du das nicht warst.",
          "Passwort zurücksetzen",
          url,
        ),
      });
    },
  };
}
