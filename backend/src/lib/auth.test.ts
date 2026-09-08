import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertJwtSecret } from "./auth.js";

describe("JWT_SECRET", () => {
  it("refuse le placeholder et les secrets trop courts", () => {
    assert.throws(() => assertJwtSecret(undefined));
    assert.throws(() => assertJwtSecret(""));
    assert.throws(() => assertJwtSecret("changez-ce-secret-en-production-lan-clinique-alwatan"));
    assert.throws(() => assertJwtSecret("trop-court"));
    assert.doesNotThrow(() => assertJwtSecret("a".repeat(32)));
  });
});
