export interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
  /** Comma-separated Access service-token client IDs allowed to POST /api/ingest/* (optional). */
  ALLOWED_SERVICE_TOKENS?: string;
  /** 32 random bytes, base64. `openssl rand -base64 32` then `wrangler secret put TOKEN_KEY`. */
  TOKEN_KEY: string;
  /** Optional USDA FoodData Central key. Without it the shared DEMO_KEY is used (rate limited). */
  FDC_API_KEY?: string;
  /** Local development only (`.dev.vars`). See auth.ts. Never set in production. */
  LOCAL_DEV?: string;
}
