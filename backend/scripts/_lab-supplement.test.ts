import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearLabSupplementPending,
  hasLabSupplementPending,
  isLabDossierClosed,
  markLabSupplementPending,
} from "./lab-notes.js";
import { appendLabResultsCompletion } from "./lab-panel-results.js";

describe("complément d'examen après résultats validés", () => {
  it("ne marque pas un dossier sans résultats validés", () => {
    const notes = "Examens prescrits (Laboratoire) : NFS";
    assert.equal(markLabSupplementPending(notes), notes);
  });

  it("rouvre le parcours labo sans perdre les résultats validés", () => {
    const validated = appendLabResultsCompletion("Examens prescrits (Laboratoire) : NFS");
    assert.equal(isLabDossierClosed(validated), true);
    const reopened = markLabSupplementPending(validated);
    assert.equal(hasLabSupplementPending(reopened), true);
    assert.equal(isLabDossierClosed(reopened), false);
    assert.equal(markLabSupplementPending(reopened), reopened);
  });

  it("la nouvelle validation referme le dossier", () => {
    const reopened = markLabSupplementPending(appendLabResultsCompletion("x"));
    const closed = appendLabResultsCompletion(reopened);
    assert.equal(hasLabSupplementPending(closed), false);
    assert.equal(isLabDossierClosed(closed), true);
    assert.equal(clearLabSupplementPending(reopened).includes("complément"), false);
  });
});
