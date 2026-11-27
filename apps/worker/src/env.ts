export interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
  /** Comma-separated Access service-token client IDs allowed to POST /api/ingest/* (optional). */
  ALLOWED_SERVICE_TOKENS?: string;
  /** 32 random bytes, base64. `openssl rand -base64 32` then `wrangler secret put TOKEN_KEY`. */
  TOKEN_KEY: string;
  /** Optional separate key for encrypted backups (defaults to TOKEN_KEY). */
  BACKUP_KEY?: string;
  /** Optional R2 bucket for nightly encrypted backups. */
  BACKUPS?: R2Bucket;
  /** Google sign-in (Gmail read-only + Calendar). Create an OAuth client at console.cloud.google.com. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Microsoft sign-in (Outlook mail read-only + Calendar). Register an app at entra.microsoft.com. */
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  /** Microsoft tenant: "common" (default) allows personal and work accounts. */
  MS_TENANT?: string;
  /** Public address of the app, for OAuth redirects. Defaults to the address the request came to. */
  PUBLIC_URL?: string;
  /** Optional. Enables Claude for email reading and chat. Stored as a Worker secret, never in the browser. */
  ANTHROPIC_API_KEY?: string;
  /** Optional model override for chat (default: the small model). */
  CHAT_MODEL?: string;
  /** Optional daily chat spend cap in US dollars (default 1.00). */
  CHAT_DAILY_CAP_USD?: string;
  /** Optional USDA FoodData Central key. Without it the shared DEMO_KEY is used (rate limited). */
  FDC_API_KEY?: string;
  /** Local development only (`.dev.vars`). See auth.ts. Never set in production. */
  LOCAL_DEV?: string;
}
