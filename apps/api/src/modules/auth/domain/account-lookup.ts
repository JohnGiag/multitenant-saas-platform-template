// Sign-in and password reset find accounts by email before any tenant is known: the one place a query on
// users does not filter by tenant_id (see CLAUDE.md). Capped, because each account costs an Argon2 check
// (sign-in) or an email (reset).
// shortcut: an email with more accounts than this can only reach the rest by naming the tenant (tenantId).
export const MAX_ACCOUNTS_PER_EMAIL = 10;
