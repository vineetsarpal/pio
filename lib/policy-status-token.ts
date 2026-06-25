import { createHmac, timingSafeEqual } from "node:crypto";

type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_token" | "malformed" | "signature_mismatch" | "expired" };

function secret(): string {
  const value = process.env.PIO_POLICY_STATUS_TOKEN_SECRET;
  if (!value) {
    throw new Error("PIO_POLICY_STATUS_TOKEN_SECRET is required to sign/verify policy status tokens.");
  }
  return value;
}

function hmac(policyId: string, expiresAtEpochSeconds: number): string {
  return createHmac("sha256", secret()).update(`${policyId}.${expiresAtEpochSeconds}`).digest("hex");
}

export function signPolicyStatusToken(policyId: string, expiresAtEpochSeconds: number): string {
  return `${expiresAtEpochSeconds}.${hmac(policyId, expiresAtEpochSeconds)}`;
}

export function verifyPolicyStatusToken(policyId: string, token: string | null | undefined): VerifyResult {
  if (!token) return { ok: false, reason: "missing_token" };

  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };

  const expRaw = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || providedSig.length === 0 || !/^[0-9a-f]+$/.test(providedSig)) {
    return { ok: false, reason: "malformed" };
  }

  const expectedBuffer = Buffer.from(hmac(policyId, exp), "hex");
  const providedBuffer = Buffer.from(providedSig, "hex");
  const matches =
    providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
  if (!matches) return { ok: false, reason: "signature_mismatch" };

  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };
  return { ok: true };
}
