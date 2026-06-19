import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// The neon-serverless driver talks to Neon over WebSocket. Node has a global
// WebSocket from v22, but provide `ws` explicitly so this also works on older
// runtimes and in tooling.
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

type Db = NeonDatabase<typeof schema>;

// Cache the pool + Drizzle client on globalThis so warm serverless instances and
// dev HMR reuse a single client instead of opening a new pool per request
// (which would exhaust Neon's connection limit). Mirrors the repo's prior
// globalThis store-caching pattern.
const globalForDb = globalThis as typeof globalThis & {
  pioDbPool?: Pool;
  pioDb?: Db;
};

export function getDb(): Db {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. The policy store must be durable; point DATABASE_URL at the Neon pooled connection string."
    );
  }
  if (globalForDb.pioDb) {
    return globalForDb.pioDb;
  }
  const pool = (globalForDb.pioDbPool ??= new Pool({ connectionString }));
  const db = drizzle(pool, { schema });
  globalForDb.pioDb = db;
  return db;
}
