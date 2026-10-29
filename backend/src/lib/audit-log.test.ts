import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditRetentionCutoff, describeAuditPath, sanitizeAuditBody } from "./audit-log.js";

describe("audit-log", () => {
  it("masque les secrets et les fichiers", () => {
    const clean = sanitizeAuditBody({
      username: "jdoe",
      password: "secret",
      newPassword: "x",
      fileBase64: "AAAA",
      lines: [{ productId: "p1", quantity: 2 }],
    }) as Record<string, unknown>;
    assert.equal(clean.username, "jdoe");
    assert.equal(clean.password, "***");
    assert.equal(clean.newPassword, "***");
    assert.equal(clean.fileBase64, "***");
    assert.deepEqual(clean.lines, [{ productId: "p1", quantity: 2 }]);
  });

  it("ignore un corps vide", () => {
    assert.equal(sanitizeAuditBody({}), null);
    assert.equal(sanitizeAuditBody(undefined), null);
  });

  it("déduit le module et l'identifiant de l'URL", () => {
    assert.deepEqual(describeAuditPath("/api/pharmacie/sales/cmrkin4770002u9igsh3amz8j"), {
      entity: "pharmacie",
      entityId: "cmrkin4770002u9igsh3amz8j",
    });
    assert.deepEqual(describeAuditPath("/api/auth/login"), { entity: "auth", entityId: null });
  });

  it("conserve 2 mois", () => {
    const cutoff = auditRetentionCutoff(new Date(2026, 9, 29, 10));
    assert.equal(cutoff.getFullYear(), 2026);
    assert.equal(cutoff.getMonth(), 7);
    assert.equal(cutoff.getDate(), 29);
  });
});
