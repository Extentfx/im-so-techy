export interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
  /** 32 random bytes, base64. `openssl rand -base64 32` then `wrangler secret put TOKEN_KEY`. */
  TOKEN_KEY: string;
}
