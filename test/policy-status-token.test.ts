import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signPolicyStatusToken, verifyPolicyStatusToken } from "@/lib/policy-status-token";

const original = process.env.PIO_POLICY_STATUS_TOKEN_SECRET;
beforeEach(() => {
  process.env.PIO_POLICY_STATUS_TOKEN_SECRET = "test-status-secret";
});
afterEach(() => {
  if (original === undefined) delete process.env.PIO_POLICY_STATUS_TOKEN_SECRET;
  else process.env.PIO_POLICY_STATUS_TOKEN_SECRET = original;
});

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 1;

describe("policy status token", () => {
  it("round-trips a valid token", () => {
    const token = signPolicyStatusToken("pio-pol-abc", future());
    expect(verifyPolicyStatusToken("pio-pol-abc", token)).toEqual({ ok: true });
  });

  it("rejects a missing token", () => {
    expect(verifyPolicyStatusToken("pio-pol-abc", null)).toEqual({ ok: false, reason: "missing_token" });
  });

  it("rejects a malformed token", () => {
    expect(verifyPolicyStatusToken("pio-pol-abc", "not-a-token")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a tampered signature", () => {
    const token = signPolicyStatusToken("pio-pol-abc", future());
    const [exp] = token.split(".");
    expect(verifyPolicyStatusToken("pio-pol-abc", `${exp}.deadbeef`)).toEqual({
      ok: false,
      reason: "signature_mismatch"
    });
  });

  it("rejects a token signed for a different policy", () => {
    const token = signPolicyStatusToken("pio-pol-abc", future());
    expect(verifyPolicyStatusToken("pio-pol-xyz", token)).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects an expired token", () => {
    const token = signPolicyStatusToken("pio-pol-abc", past());
    expect(verifyPolicyStatusToken("pio-pol-abc", token)).toEqual({ ok: false, reason: "expired" });
  });

  it("throws if the secret is unset", () => {
    delete process.env.PIO_POLICY_STATUS_TOKEN_SECRET;
    expect(() => signPolicyStatusToken("pio-pol-abc", future())).toThrow(/PIO_POLICY_STATUS_TOKEN_SECRET/);
  });
});
