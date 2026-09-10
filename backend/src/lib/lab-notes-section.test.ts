import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractBasePanelLabel,
  extractPrescribedFieldLabels,
  extractSelectedFormLabels,
} from "./lab-notes.js";

describe("prescription labo — section entière", () => {
  it("extrait le nom de section sans liste de champs", () => {
    assert.deepEqual(extractPrescribedFieldLabels("Routine Investigation (Urine General)"), [
      "Urine General",
    ]);
  });

  it("conserve le format héritage champ par champ", () => {
    assert.deepEqual(
      extractPrescribedFieldLabels("Routine Investigation (Urine General: Colour)"),
      ["Colour"],
    );
  });
});

describe("prescription labo — parenthèses dans le libellé panel", () => {
  it("ne traite pas (TFT) comme une sélection", () => {
    assert.equal(extractBasePanelLabel("Thyroid Hormones Test ( TFT)"), "Thyroid Hormones Test ( TFT)");
    assert.equal(extractSelectedFormLabels("Thyroid Hormones Test ( TFT)"), null);
    assert.deepEqual(extractPrescribedFieldLabels("Thyroid Hormones Test ( TFT)"), []);
  });

  it("extrait T3 après Thyroid Hormones Test ( TFT)", () => {
    const line = "Thyroid Hormones Test ( TFT) (Formulaire principal: T3)";
    assert.equal(extractBasePanelLabel(line), "Thyroid Hormones Test ( TFT)");
    assert.deepEqual(extractPrescribedFieldLabels(line), ["T3"]);
  });

  it("conserve BHCG / NFS comme partie du nom d'examen", () => {
    assert.equal(extractSelectedFormLabels("Test de grossesse (BHCG)"), null);
    assert.equal(extractSelectedFormLabels("Numération formule sanguine (NFS)"), null);
  });
});
