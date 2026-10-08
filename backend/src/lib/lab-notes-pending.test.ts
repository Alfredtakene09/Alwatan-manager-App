import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PatientCategory } from "@prisma/client";
import {
  buildPrescribedExamsNotesByKind,
  hasExamListContent,
  hasPaidLabWorkPending,
  hasUnpaidCashierQueueExams,
  isExamKindPaid,
  isOperationOnlyPrescription,
  labsPendingApprovalWhere,
  labsWaitingWhere,
  mergeExamsByKind,
  parseBilledExamLabelsByKind,
  parsePrescribedExamsByKind,
  parseRemovedExamLabelsByKind,
  payableExamLabels,
  removedExamCreditFcfa,
  syncBillingForDoctorLineChange,
} from "./lab-notes.js";

describe("file d'attente paiement examens", () => {
  it("inclut STANDARD et ONG (comme la file médecin « en paiement »)", () => {
    const where = labsPendingApprovalWhere();
    const visitAnd = where.visit.AND as Array<Record<string, unknown>>;
    assert.deepEqual(visitAnd[0], {
      patient: {
        category: { in: [PatientCategory.STANDARD, PatientCategory.ONG] },
      },
    });
  });

  it("n'exclut pas les visites dont les notes sont nulles (SQL NOT LIKE ignore les NULL)", () => {
    const where = labsPendingApprovalWhere();
    const visitAnd = where.visit.AND as Array<{ OR?: unknown }>;
    assert.deepEqual(visitAnd[1], {
      OR: [
        { notes: null },
        { NOT: { notes: { contains: "PATIENT_EXTERNE" } } },
      ],
    });
  });

  it("exclut les visites annulées de la file d'attente paiement", () => {
    const where = labsPendingApprovalWhere();
    const visitAnd = where.visit.AND as Array<Record<string, unknown>>;
    assert.deepEqual(visitAnd[2], { status: { not: "CANCELLED" } });
  });

  it("reconnaît une prescription laboratoire comme encaissable à la caisse", () => {
    const notes = buildPrescribedExamsNotesByKind({ examen: ["NFS"] });
    assert.equal(hasUnpaidCashierQueueExams(notes), true);
  });

  it("classe Lipome / Ablation comme opération seule (hors liste examens)", () => {
    const notes = buildPrescribedExamsNotesByKind({ operation: ["Lipome"] });
    assert.equal(isOperationOnlyPrescription(notes), true);
    assert.equal(hasExamListContent(notes), false);
  });

  it("garde Hormones + Glycémie dans la liste examens", () => {
    const notes = buildPrescribedExamsNotesByKind({
      examen: ["Hormones", "Glycémie"],
      echo: ["ECG"],
    });
    assert.equal(isOperationOnlyPrescription(notes), false);
    assert.equal(hasExamListContent(notes), true);
  });

  it("renvoie à la caisse le prix des lignes ajoutées par le médecin après paiement", () => {
    const prices: Record<string, number> = {
      RFT: 10_000,
      CBC: 5_000,
      "Ca+": 5_000,
      "Thyroid Hormones Test ( TFT) (Formulaire principal: T3)": 10_000,
      "Thyroid Hormones Test ( TFT) (Formulaire principal: T4)": 10_000,
      "Thyroid Hormones Test ( TFT) (Formulaire principal: TSH)": 10_000,
      "LFT (Formulaire principal: ALP)": 5_000,
      "Biochimie (Formulaire principal: Mg++)": 5_000,
      "Tumor marker (Formulaire principal: Vitamin D level)": 10_000,
    };
    const labels = Object.keys(prices);
    const paid = labels.slice(0, 7);
    const notes = [
      `Examens prescrits (Laboratoire) : ${paid.join(", ")}`,
      "Examens payés (Laboratoire) : 2026-10-06T11:18:17.845Z",
    ].join("\n");
    const priceOf = (label: string) => prices[label] ?? 0;
    const next = syncBillingForDoctorLineChange(notes, { examen: labels }, priceOf);
    const rebuilt = buildPrescribedExamsNotesByKind({ examen: labels }, next);
    assert.deepEqual(parseBilledExamLabelsByKind(rebuilt).examen, paid);
    assert.deepEqual(payableExamLabels(rebuilt, "examen"), labels.slice(7));
    assert.equal(isExamKindPaid(rebuilt, "examen"), false);
    assert.equal(hasUnpaidCashierQueueExams(rebuilt), true);
    assert.equal(
      payableExamLabels(rebuilt, "examen").reduce((sum, label) => sum + priceOf(label), 0),
      15_000,
    );
  });

  it("encaisse seulement l'écart quand le médecin remplace une ligne déjà payée", () => {
    const prices: Record<string, number> = { NFS: 5_000, GE: 3_000, CRP: 8_000 };
    const notes = [
      "Examens prescrits (Laboratoire) : NFS, GE",
      "Examens payés (Laboratoire) : 2026-10-06T11:18:17.845Z",
    ].join("\n");
    const priceOf = (label: string) => prices[label] ?? 0;
    const next = syncBillingForDoctorLineChange(notes, { examen: ["NFS", "CRP"] }, priceOf);
    const rebuilt = buildPrescribedExamsNotesByKind({ examen: ["NFS", "CRP"] }, next);
    assert.deepEqual(payableExamLabels(rebuilt, "examen"), ["CRP"]);
    assert.deepEqual(parseRemovedExamLabelsByKind(rebuilt).examen, ["GE"]);
    assert.equal(isExamKindPaid(rebuilt, "examen"), false);
    assert.equal(8_000 - removedExamCreditFcfa(rebuilt, "examen", priceOf), 5_000);
  });

  it("ne réouvre pas la caisse si le médecin retire une ligne moins chère ou égale", () => {
    const notes = [
      "Examens prescrits (Laboratoire) : NFS, GE",
      "Examens payés (Laboratoire) : 2026-10-06T11:18:17.845Z",
    ].join("\n");
    const next = syncBillingForDoctorLineChange(
      notes,
      { examen: ["NFS"] },
      (label) => (label === "NFS" ? 5_000 : 3_000),
    );
    const rebuilt = buildPrescribedExamsNotesByKind({ examen: ["NFS"] }, next);
    assert.deepEqual(payableExamLabels(rebuilt, "examen"), []);
    assert.equal(isExamKindPaid(rebuilt, "examen"), true);
    assert.equal(hasUnpaidCashierQueueExams(rebuilt), false);
    assert.equal(payableExamLabels(rebuilt, "examen").length, 0);
  });

  it("facture le tarif du champ ajouté après paiement, pas le tarif général", () => {
    const fbg = "Diabetic Test (Formulaire principal: FBG)";
    const hba1c = "Diabetic Test (Formulaire principal: HbA1c)";
    const rbg = "Diabetic Test (Formulaire principal: RBG)";
    const prices: Record<string, number> = {
      [fbg]: 4_000,
      [hba1c]: 10_000,
      [rbg]: 4_000,
      "Diabetic Test": 22_000,
    };
    const notes = [
      `Examens prescrits (Laboratoire) : ${fbg}, ${hba1c}`,
      "Examens payés (Laboratoire) : 2026-10-07T07:18:18.592Z",
    ].join("\n");
    const priceOf = (label: string) => prices[label] ?? 0;
    const merged = mergeExamsByKind(
      { examen: [fbg, hba1c] } as never,
      { examen: [rbg] },
    );
    const next = syncBillingForDoctorLineChange(notes, { examen: merged.examen }, priceOf);
    const rebuilt = buildPrescribedExamsNotesByKind({ examen: merged.examen }, next);
    assert.deepEqual(payableExamLabels(rebuilt, "examen"), [rbg]);
    assert.equal(
      payableExamLabels(rebuilt, "examen").reduce((sum, label) => sum + priceOf(label), 0),
      4_000,
    );
  });

  it("n'ajoute pas le tarif général par-dessus des champs déjà choisis", () => {
    const fbg = "Diabetic Test (Formulaire principal: FBG)";
    const merged = mergeExamsByKind(
      { examen: [fbg, "CBC"] } as never,
      { examen: ["Diabetic Test", "Diabetic Test (Formulaire principal: RBG)"] },
    );
    assert.deepEqual(merged.examen, [
      fbg,
      "CBC",
      "Diabetic Test (Formulaire principal: RBG)",
    ]);
  });
});

describe("file laboratoire — examens payés", () => {
  it("lit l'ancien libellé « Examen » comme type laboratoire", () => {
    const notes =
      "Examens prescrits (Examen) : NFS\nExamens payés (Examen) : 2026-09-21T07:48:58.417Z";
    assert.deepEqual(parsePrescribedExamsByKind(notes).examen, ["NFS"]);
    assert.equal(hasPaidLabWorkPending(notes, null), true);
  });

  it("inclut les dossiers soldés sans tampon labSentToLabAt dans le filtre SQL", () => {
    const dumped = JSON.stringify(labsWaitingWhere());
    assert.ok(dumped.includes("Examens payés (Laboratoire)"));
    assert.ok(dumped.includes("Examens payés (Examen)"));
    assert.ok(dumped.includes("billingExamKind"));
  });
});
