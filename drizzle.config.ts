import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations and the runtime store both read NEON_POSTGRES_CONNECTION_STRING,
// provisioned by Stripe Projects. Point it at the direct (unpooled) endpoint for
// migrations; DDL should not run through PgBouncer's transaction-pooling mode.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.NEON_POSTGRES_CONNECTION_STRING ?? ""
  }
});
