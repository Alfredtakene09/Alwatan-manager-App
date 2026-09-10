import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRole } from "@prisma/client";
import { receptionistOwnVisitsWhere } from "./reception-scope.js";

describe("périmètre réceptionniste", () => {
  it("isole les dossiers du réceptionniste (listes patients / CA perso)", () => {
    const where = receptionistOwnVisitsWhere({ id: "rec-1", role: UserRole.RECEPTIONNISTE });
    assert.deepEqual(where, {
      OR: [
        { patient: { createdById: "rec-1" } },
        { invoices: { some: { issuedById: "rec-1" } } },
      ],
    });
  });

  it("n'isole pas gestionnaire / direction / admin", () => {
    const where = receptionistOwnVisitsWhere({ id: "admin-1", role: UserRole.ADMIN });
    assert.deepEqual(where, {});
  });
});
