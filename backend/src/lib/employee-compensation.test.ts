import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactEmployeeCompensation } from "./employee.js";
import { canViewEmployeeCompensation, USER_ROLES, type AppUserRole } from "./roles.js";

describe("canViewEmployeeCompensation", () => {
  it("autorise admin, direction et gestionnaire", () => {
    assert.equal(canViewEmployeeCompensation("ADMIN"), true);
    assert.equal(canViewEmployeeCompensation("GESTIONNAIRE"), true);
    assert.equal(canViewEmployeeCompensation("COMPTABLE"), true);
  });

  it("refuse les autres rôles", () => {
    const denied = USER_ROLES.filter(
      (role) => !["ADMIN", "GESTIONNAIRE", "COMPTABLE"].includes(role),
    ) as AppUserRole[];
    for (const role of denied) {
      assert.equal(canViewEmployeeCompensation(role), false, role);
    }
  });
});

describe("redactEmployeeCompensation", () => {
  const sample = {
    id: "e1",
    firstName: "Awa",
    fixedSalaryFcfa: 250_000,
    bonusFcfa: 10_000,
    overtimeHourlyRateFcfa: 5_000,
    jobTitle: "Réceptionniste",
  };

  it("conserve les montants pour un rôle autorisé", () => {
    assert.deepEqual(redactEmployeeCompensation(sample, true), sample);
  });

  it("neutralise les montants pour un rôle non autorisé", () => {
    const redacted = redactEmployeeCompensation(sample, false);
    assert.equal(redacted.fixedSalaryFcfa, null);
    assert.equal(redacted.bonusFcfa, null);
    assert.equal(redacted.overtimeHourlyRateFcfa, null);
    assert.equal(redacted.jobTitle, "Réceptionniste");
    assert.equal(redacted.firstName, "Awa");
  });
});
