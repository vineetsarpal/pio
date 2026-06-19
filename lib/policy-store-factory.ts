import { getDb } from "./db/client";
import type { PolicyStore } from "./policy-store";
import { PostgresPolicyStore } from "./postgres-policy-store";

let cached: PostgresPolicyStore | undefined;

/**
 * Returns the durable policy store for runtime request paths.
 *
 * Requires `DATABASE_URL` and throws if it is missing — it never silently falls
 * back to an in-memory store. The money path must be durable or fail loudly; a
 * quiet in-memory fallback (premiums recorded to a map that vanishes on cold
 * start) would be an invisible, catastrophic bug. `InMemoryPolicyStore` is
 * reserved for tests, which construct it directly.
 */
export function getPolicyStore(): PolicyStore {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to serve this route. The policy store must be durable; in-memory is test-only."
    );
  }
  return (cached ??= new PostgresPolicyStore(getDb()));
}
