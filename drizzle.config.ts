import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations run against the DIRECT (unpooled) Neon connection string — the one
// provisioned by Stripe Projects — because DDL should not go through PgBouncer's
// transaction-pooling mode. Runtime queries use the pooled DATABASE_URL instead.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.NEON_POSTGRES_CONNECTION_STRING ?? ""
  }
});
