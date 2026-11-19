import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shiftLabelFromLogins } from "./reception-shift.js";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);

describe("reception-shift", () => {
  it("1re connexion à partir de 8 h = matin, la suivante = soir", () => {
    const logins = [
      { userId: "b", at: at(19, 15) },
      { userId: "a", at: at(19, 8, 5) },
    ];
    assert.equal(shiftLabelFromLogins(logins, "a"), "Matin");
    assert.equal(shiftLabelFromLogins(logins, "b"), "Soir");
  });

  it("ignore les connexions avant 8 h", () => {
    const logins = [
      { userId: "b", at: at(19, 7, 30) },
      { userId: "a", at: at(19, 9) },
      { userId: "b", at: at(19, 16) },
    ];
    assert.equal(shiftLabelFromLogins(logins, "a"), "Matin");
    assert.equal(shiftLabelFromLogins(logins, "b"), "Soir");
  });

  it("matin un jour, soir un autre : les deux", () => {
    const logins = [
      { userId: "a", at: at(19, 8) },
      { userId: "b", at: at(19, 14) },
      { userId: "b", at: at(20, 8) },
      { userId: "a", at: at(20, 14) },
    ];
    assert.equal(shiftLabelFromLogins(logins, "a"), "Matin et soir");
  });

  it("aucune connexion : pas de poste", () => {
    assert.equal(shiftLabelFromLogins([{ userId: "a", at: at(19, 9) }], "b"), null);
  });
});
