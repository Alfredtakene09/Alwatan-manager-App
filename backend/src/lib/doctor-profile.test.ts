import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveDoctorCategory, inferDoctorCategory, normalizeDoctorCategory } from "./doctor-profile.js";

describe("catégorie médecin", () => {
  it("déduit la catégorie du poste, puis de la spécialité", () => {
    assert.equal(inferDoctorCategory({ jobTitle: "Médecin généraliste" }), "GENERALISTE");
    assert.equal(inferDoctorCategory({ jobTitle: "Médecin spécialiste" }), "SPECIALISTE");
    assert.equal(inferDoctorCategory({ jobTitle: "Chirurgien" }), "SPECIALISTE");
    assert.equal(inferDoctorCategory({ jobTitle: "Genecologue" }), "SPECIALISTE");
    assert.equal(inferDoctorCategory({ jobTitle: "Medecin interne" }), "AUTRE");
    assert.equal(
      inferDoctorCategory({ jobTitle: "Médecin", specialty: "Médecine générale" }),
      "GENERALISTE",
    );
    assert.equal(inferDoctorCategory({ jobTitle: "Médecin", specialty: null }), "AUTRE");
  });

  it("la catégorie choisie sur la fiche prime sur la déduction", () => {
    assert.equal(
      effectiveDoctorCategory({
        isMedecin: true,
        doctorCategory: "AUTRE",
        jobTitle: "Médecin généraliste",
      }),
      "AUTRE",
    );
    assert.equal(
      effectiveDoctorCategory({ isMedecin: true, doctorCategory: null, jobTitle: "Radiologue" }),
      "SPECIALISTE",
    );
  });

  it("le personnel n'a pas de catégorie médecin", () => {
    assert.equal(
      effectiveDoctorCategory({ isMedecin: false, doctorCategory: "SPECIALISTE", jobTitle: "x" }),
      null,
    );
    assert.equal(normalizeDoctorCategory("GENERALISTE", false), null);
    assert.equal(normalizeDoctorCategory("GENERALISTE", true), "GENERALISTE");
  });
});
