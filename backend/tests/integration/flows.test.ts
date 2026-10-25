/**
 * Tests d'intégration des flux et des exports, de bout en bout via l'API,
 * sur une base « alwatan_test » recréée vide et remplie avec nos propres données.
 *
 *   npm run test:integration          (depuis backend/)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import {
  ApiClient,
  backendRoot,
  resetTestDatabase,
  startTestServer,
  stopTestServer,
  todayIso,
} from "./harness.js";
import { FEES, TEST_PASSWORD, insertFixtures, type Fixtures } from "./fixtures.js";

let fx: Fixtures;
let testUrl = "";
// Client Prisma ouvert sur la base de test, pour vérifier ce que l'API a écrit.
let db: typeof import("../../src/lib/db.js")["prisma"];

const api = {
  admin: new ApiClient("admin"),
  gest: new ApiClient("gestionnaire"),
  recep: new ApiClient("réception"),
  compta: new ApiClient("comptable"),
  pharma: new ApiClient("pharmacien"),
};

const today = todayIso();
const ids: Record<string, string> = {};

before(async () => {
  testUrl = await resetTestDatabase();
  process.env.ALWATAN_TEST_DATABASE_URL = testUrl;
  fx = await insertFixtures();
  db = (await import("../../src/lib/db.js")).prisma;
  await startTestServer(testUrl);
  await api.admin.login("admin_test", TEST_PASSWORD);
  await api.gest.login("gest_test", TEST_PASSWORD);
  await api.recep.login("recep_test", TEST_PASSWORD);
  await api.compta.login("compta_test", TEST_PASSWORD);
  await api.pharma.login("pharma_test", TEST_PASSWORD);
});

after(async () => {
  stopTestServer();
  await db?.$disconnect();
});

const patient = (firstName: string, extra: Record<string, unknown> = {}) => ({
  firstName,
  lastName: "Testeur",
  age: 30,
  ageUnit: "YEARS",
  phone: "66000000",
  gender: "F",
  ...extra,
});

async function consultationInvoice(patientId: string) {
  return db.invoice.findFirst({ where: { patientId, type: "CONSULTATION" } });
}

describe("Patient personnel — enregistrement et réduction", () => {
  it("refuse l'enregistrement par la réception", async () => {
    const res = await api.recep.post("/patients/register-consultation", {
      ...patient("Refuse", { category: "PERSONNEL", recommendedByName: "Collègue" }),
      service: "Gynécologie",
      doctorId: fx.users.drGyn.id,
    });
    assert.equal(res.status, 403, JSON.stringify(res.data));
  });

  it("enregistre par le gestionnaire avec 20 % de réduction sur la consultation", async () => {
    const res = await api.gest.post("/patients/register-consultation", {
      ...patient("Staff", { category: "PERSONNEL", recommendedByName: "Collègue" }),
      service: "Gynécologie",
      doctorId: fx.users.drGyn.id,
    });
    assert.ok(res.status < 300, JSON.stringify(res.data));
    ids.staff = res.data.patient.id;
    const invoice = await consultationInvoice(ids.staff);
    assert.equal(invoice?.amountFcfa, FEES.gynConsultation * 0.8);
    assert.equal(invoice?.status, "PAID");
  });

  it("ne laisse que l'admin ou le gestionnaire changer le %", async () => {
    const refused = await api.recep.patch(`/patients/${ids.staff}/discount`, { discountPercent: 50 });
    assert.equal(refused.status, 403);
    const ok = await api.admin.patch(`/patients/${ids.staff}/discount`, { discountPercent: 30 });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.discountPercent, 30);
  });
});

describe("Patient standard et cumul des enregistrements (export)", () => {
  it("facture la consultation au tarif plein", async () => {
    const res = await api.recep.post("/patients/register-consultation", {
      ...patient("Standard"),
      service: "Gynécologie",
      doctorId: fx.users.drGyn.id,
    });
    assert.ok(res.status < 300, JSON.stringify(res.data));
    const invoice = await consultationInvoice(res.data.patient.id);
    assert.equal(invoice?.amountFcfa, FEES.gynConsultation);
  });

  it("affiche le médecin et sa part sur chaque ligne du cumul", async () => {
    const res = await api.gest.get(`/patients/registration-summary?from=${today}&to=${today}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const lines: any[] = res.data.lines;
    const gyn = lines.find((line) => line.group === "consultation" && /gyn/i.test(line.service));
    assert.ok(gyn, `ligne Gynécologie absente : ${JSON.stringify(lines)}`);
    const expectedAmount = FEES.gynConsultation + FEES.gynConsultation * 0.8;
    assert.equal(gyn.amountFcfa, expectedAmount);
    assert.equal(gyn.doctorShareFcfa, expectedAmount * (FEES.consultationQuotaPercent / 100));
    assert.deepEqual(gyn.doctorNames, ["dr_gyn Test"]);
    for (const line of lines) {
      if (line.doctorShareFcfa > 0) assert.ok(line.doctorNames.length > 0, `${line.service} sans médecin`);
      assert.equal(line.doctorShareFcfa + line.clinicShareFcfa, line.amountFcfa, line.service);
      if (line.doctorShares.length) {
        const sum = line.doctorShares.reduce((total: number, e: any) => total + e.shareFcfa, 0);
        assert.equal(sum, line.doctorShareFcfa, line.service);
      }
    }
  });
});

describe("Opération — anesthésiste obligatoire", () => {
  const operation = (firstName: string, serviceId: string, doctorId: string, extra: Record<string, unknown> = {}) => ({
    ...patient(firstName),
    examsByKind: { operation: [`Intervention ${firstName}`] },
    operationAmountFcfa: 200_000,
    amountFcfa: 200_000,
    operationSurgeonPercent: FEES.surgeryQuotaPercent,
    operationServiceId: serviceId,
    doctorId,
    deferCollection: true,
    ...extra,
  });

  it("refuse une chirurgie générale sans anesthésiste", async () => {
    const res = await api.recep.post(
      "/visits/external-lab-order",
      operation("SansAnest", fx.services.surgery.id, fx.users.drSurgery.id),
    );
    assert.equal(res.status, 400);
    assert.match(String(res.data.error), /anesthésiste/i);
  });

  it("accepte l'ophtalmologie sans anesthésiste", async () => {
    const res = await api.recep.post(
      "/visits/external-lab-order",
      operation("Ophta", fx.services.ophta.id, fx.users.drOphta.id),
    );
    assert.ok(res.status < 300, JSON.stringify(res.data));
  });

  it("enregistre l'anesthésiste et son % quand il est fourni", async () => {
    const res = await api.recep.post(
      "/visits/external-lab-order",
      operation("AvecAnest", fx.services.surgery.id, fx.users.drSurgery.id, {
        operationAssistant: {
          anesthesiologistId: fx.users.anesthetist.id,
          anesthesiologistPercent: FEES.anesthetistPercent,
        },
      }),
    );
    assert.ok(res.status < 300, JSON.stringify(res.data));
    const surgery = await db.surgeryCase.findFirst({
      where: { visit: { patient: { firstName: "AvecAnest" } } },
      include: { interventionType: true },
    });
    assert.ok(surgery, "dossier d'opération créé");
    const percent = surgery.anesthesiologistPercent ?? surgery.interventionType.anesthesiologistPercent;
    assert.equal(percent, FEES.anesthetistPercent);
  });
});

describe("Examens — réduction personnel à l'encaissement", () => {
  it("encaisse l'examen avec la réduction de la fiche (30 %)", async () => {
    // Patient personnel sans visite en cours (un dossier en consultation refuse un examen externe).
    const staffExam = await db.patient.create({
      data: {
        code: "PERS-EXAM",
        firstName: "StaffExam",
        lastName: "Testeur",
        category: "PERSONNEL",
        discountPercent: 30,
      },
    });
    ids.staffExam = staffExam.id;
    const order = await api.gest.post("/visits/external-lab-order", {
      patientId: ids.staffExam,
      examsByKind: { examen: [fx.exam.label] },
      doctorId: fx.users.drGyn.id,
      deferCollection: true,
    });
    assert.ok(order.status < 300, JSON.stringify(order.data));
    const consultation = await db.consultation.findFirst({
      where: { visit: { patientId: ids.staffExam }, clinicalNotes: { contains: fx.exam.label } },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(consultation, "prescription créée");
    const pay = await api.compta.post("/comptabilite", {
      action: "pay_lab_exams",
      consultationId: consultation.id,
      kinds: ["examen"],
    });
    assert.ok(pay.status < 300, JSON.stringify(pay.data));
    const invoice = await db.invoice.findFirst({
      where: { patientId: ids.staffExam, type: "LAB_EXAM", billingExamKind: "examen" },
    });
    assert.equal(invoice?.amountFcfa, FEES.examPrice * 0.7);
  });
});

describe("Dépenses et cartes du tableau de bord", () => {
  const kpis = async () =>
    (await api.admin.get(`/dashboard/admin?from=${today}&to=${today}`)).data.financialKpis;

  it("ajoute une sortie et une entrée du jour aux cartes, puis retire la sortie supprimée", async () => {
    const before = await kpis();
    const out = await api.compta.post("/cash-desk/expenses", {
      businessDate: today,
      amountFcfa: 7_000,
      label: "Sortie test",
      flow: "SORTIE",
    });
    assert.equal(out.status, 201, JSON.stringify(out.data));
    const entry = await api.compta.post("/cash-desk/expenses", {
      businessDate: today,
      amountFcfa: 3_000,
      label: "Entrée test",
      flow: "ENTREE",
    });
    assert.equal(entry.status, 201, JSON.stringify(entry.data));

    const mid = await kpis();
    assert.equal(mid.expensesMonthFcfa, before.expensesMonthFcfa + 7_000);
    assert.equal(mid.entriesMonthFcfa, before.entriesMonthFcfa + 3_000);

    const del = await api.admin.delete(`/admin/expenses/${out.data.id}`);
    assert.equal(del.status, 204);
    const afterDelete = await kpis();
    assert.equal(afterDelete.expensesMonthFcfa, before.expensesMonthFcfa);
  });
});

describe("Pharmacie — achat par facture et vente", () => {
  it("refuse l'achat par facture au pharmacien (non activé par défaut)", async () => {
    const res = await api.pharma.post("/pharmacie/purchases", {
      supplierId: fx.supplier.id,
      invoiceNumber: "FT-REFUS",
      businessDate: today,
      lines: [{ productId: fx.product.id, quantity: 1, purchasePriceFcfa: 600 }],
    });
    assert.equal(res.status, 403);
  });

  it("entre le stock et sort le total de la caisse du gestionnaire", async () => {
    const res = await api.gest.post("/pharmacie/purchases", {
      supplierId: fx.supplier.id,
      invoiceNumber: "FT-001",
      businessDate: today,
      lines: [{ productId: fx.product.id, quantity: 10, purchasePriceFcfa: FEES.productPurchasePrice }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.totalFcfa, 10 * FEES.productPurchasePrice);
    const product = await db.product.findUnique({ where: { id: fx.product.id } });
    assert.equal(product?.quantity, 60);
    const expense = await db.clinicExpense.findUnique({ where: { id: res.data.expenseId } });
    assert.equal(expense?.flow, "SORTIE");
    assert.equal(expense?.paidById, fx.users.gestionnaire.id);
  });

  it("applique la réduction personnel sur une vente", async () => {
    const res = await api.pharma.post("/pharmacie", {
      patientId: ids.staff,
      items: [{ productId: fx.product.id, quantity: 2 }],
    });
    assert.ok(res.status < 300, JSON.stringify(res.data));
    const sale = await db.prescription.findFirst({
      where: { patientId: ids.staff },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(sale?.netTotalFcfa, 2 * FEES.productSalePrice * 0.7);
  });
});

describe("Salaires — avances déduites et historique", () => {
  async function payrollRow(employeeId: string) {
    const res = await api.admin.get("/admin/payroll");
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return (res.data.rows as any[]).find((row) => row.employee.id === employeeId);
  }

  it("liste tous les employés ayant un salaire", async () => {
    const row = await payrollRow(fx.employees.salaried.id);
    assert.ok(row, "employé salarié dans la paie");
    assert.equal(row.grossFcfa, FEES.salary);
    assert.ok(await payrollRow(fx.employees.bigAdvanceEmployee.id));
  });

  it("déduit les avances, plafonnées au salaire, à la validation", async () => {
    for (const [employeeId, amountFcfa] of [
      [fx.employees.salaried.id, 30_000],
      [fx.employees.bigAdvanceEmployee.id, 150_000],
    ] as const) {
      const res = await api.admin.post("/admin/salary-advances", { employeeId, amountFcfa, businessDate: today });
      assert.equal(res.status, 201, JSON.stringify(res.data));
    }

    const small = await payrollRow(fx.employees.salaried.id);
    assert.equal(small.pendingAdvancesFcfa, 30_000);
    assert.equal(small.netFcfa, 70_000);
    const big = await payrollRow(fx.employees.bigAdvanceEmployee.id);
    assert.equal(big.pendingAdvancesFcfa, FEES.salary);
    assert.equal(big.netFcfa, 0);

    for (const row of [small, big]) {
      const res = await api.admin.post(`/admin/payroll/${row.id}/pay`);
      assert.equal(res.status, 200, JSON.stringify(res.data));
    }
    const remaining = await db.salaryAdvance.findFirst({
      where: { employeeId: fx.employees.bigAdvanceEmployee.id },
    });
    assert.equal(remaining?.remainingFcfa, 50_000);
    assert.equal(remaining?.status, "PENDING");
  });

  it("retrouve les paies validées dans l'historique filtré par date", async () => {
    const res = await api.admin.get(`/admin/payroll/history?from=${today}&to=${today}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const byEmployee = new Map((res.data.rows as any[]).map((row) => [row.employee.id, row]));
    assert.equal(byEmployee.get(fx.employees.salaried.id)?.netFcfa, 70_000);
    assert.equal(byEmployee.get(fx.employees.bigAdvanceEmployee.id)?.advanceDeductionFcfa, FEES.salary);
  });
});

describe("Audit global des flux sur les données de test", () => {
  it("ne trouve aucun écart", () => {
    const result = spawnSync("npx", ["tsx", "scripts/audit-flows.ts", today, today], {
      cwd: backendRoot,
      env: { ...process.env, ALWATAN_TEST_DATABASE_URL: testUrl },
      shell: process.platform === "win32",
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});
