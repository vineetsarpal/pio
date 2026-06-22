/**
 * Operator (Gauge) authentication. The operator is the single privileged
 * identity that runs the book — distinct from the untrusted buyer agents that
 * authenticate against the seeded agent key. It presents `PIO_OPERATOR_KEY` as
 * an `Authorization: Bearer <key>` header or `x-pio-operator-key`.
 *
 * Throws when the operator key is not configured (→ 503) and returns `false`
 * for a missing/invalid key (→ 401), mirroring the seeded-agent auth contract.
 */
export function authenticateOperator(request: Request): boolean {
  const key = process.env.PIO_OPERATOR_KEY ?? "";
  if (!key) {
    throw new Error("PIO_OPERATOR_KEY must be set to authenticate the operator.");
  }
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const presented = bearer ?? request.headers.get("x-pio-operator-key") ?? undefined;
  return presented === key;
}
