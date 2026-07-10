-- ============================================================================
-- migrations/0004_two_factor_plugin_columns.sql
-- Phase C (MFA): Spalten, die das better-auth two-factor-Plugin (v1.6.23)
-- auf dem twoFactor-Modell zusätzlich zu 0002 erwartet (verifiziert gegen
-- dist/plugins/two-factor/schema.mjs):
--   - verified                  : erst nach erfolgreichem verifyTotp true;
--                                 skipVerificationOnEnable ist bei uns false.
--   - failed_verification_count : Account-Lockout-Zähler (NIST SP 800-63B),
--                                 atomar via incrementOne.
--   - locked_until              : Sperr-Zeitpunkt nach zu vielen Fehlversuchen.
-- Forward-only, additiv (expand). auth_user.pending_role und
-- auth_session.mfa_verified/_at existieren bereits seit 0002.
-- ============================================================================

ALTER TABLE auth_two_factor ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_two_factor ADD COLUMN failed_verification_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_two_factor ADD COLUMN locked_until INTEGER;
