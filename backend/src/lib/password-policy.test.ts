import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isForbiddenPassword, newPasswordSchema } from "./password-policy.js";

describe("politique mot de passe", () => {
  it("refuse les mots de passe d'installation", () => {
    assert.equal(isForbiddenPassword("Clinique2026!"), true);
    assert.equal(isForbiddenPassword("root@Alwatan2026"), true);
    assert.equal(newPasswordSchema.safeParse("abc").success, false);
    assert.equal(newPasswordSchema.safeParse("Clinique2026!").success, false);
    assert.equal(newPasswordSchema.safeParse("CabinetAlwatan#2026").success, true);
  });
});
