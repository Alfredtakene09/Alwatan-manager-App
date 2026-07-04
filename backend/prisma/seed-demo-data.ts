/**
 * Jeu de données de démonstration — patients, visites, factures, caisse,
 * chirurgie, hospitalisation, pharmacie, dépenses, paie, etc.
 * Préfixe DEMO-PAT-* pour idempotence (SEED_DEMO_RESET=1 pour régénérer).
 */
import {
  ClinicExpenseCategory,
  ClinicExpenseStatus,
  EmployeeContractStatus,
  ExamReclamationReason,
  ExamReclamationStatus,
  HospitalizationStatus,
  InvoiceStatus,
  InvoiceType,
  PatientCategory,
  PaymentMethod,
  PayrollStatus,
  ReceptionShiftSlot,
  SalaryAdvanceStatus,
  SurgeryStatus,
  VisitStatus,
} from "@prisma/client";
import { prisma } from "../src/lib/db.js";

const DEMO_PATIENT_PREFIX = "DEMO-PAT-";
const DEMO_EMPLOYEE_FIRST_NAME = "Démo";
const DEMO_BULK_EMPLOYEE_COUNT = 35;
const DEMO_BULK_PAYROLL_MONTHS = 5;
const DEMO_BULK_SALARY_ADVANCE_COUNT = 80;
const DEMO_BULK_JOURNAL_INVOICE_COUNT = 120;

const DEMO_FIRST_NAMES = [
  "Ahmed", "Fatna", "Hassan", "Khadija", "Brahim", "Amina", "Moussa", "Zara", "Oumar", "Halima",
  "Issa", "Mariam", "Saleh", "Hawa", "Youssouf", "Adam", "Aïcha", "Mahamat", "Ali", "Djibrine",
];
const DEMO_LAST_NAMES = [
  "Mahamat", "Ali", "Djibrine", "Ousman", "Saleh", "Youssouf", "Adam", "Hassan", "Idriss", "Abakar",
  "Abdullah", "Brahim", "Oumar", "Moussa", "Haroun", "Zene", "Khalil", "Nour", "Salem", "Fadoul",
];
const DEMO_SERVICES = ["Réception", "Infirmier", "Laboratoire", "Pharmacie", "Administration", "Ménage", "Sécurité"];
const DEMO_JOB_TITLES = [
  "Réceptionniste", "Infirmier", "Aide-soignant", "Laborantin", "Agent d'entretien",
  "Secrétaire médicale", "Technicien", "Garde", "Comptable junior",
];

type StaffIds = {
  admin: string;
  gestionnaire: string;
  reception: string;
  comptable: string;
  medecin: string;
  medecin2: string;
  pharmacien: string;
  laborantin: string;
};

function daysAgo(days: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function dateOnly(days: number): Date {
  const d = daysAgo(days);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function loadStaffIds(): Promise<StaffIds> {
  const emails = [
    "admin@alwatan.local",
    "gestionnaire@alwatan.local",
    "reception@alwatan.local",
    "direction@alwatan.local",
    "medecin@alwatan.local",
    "medecin2@alwatan.local",
    "pharmacie@alwatan.local",
    "laborantin@alwatan.local",
  ] as const;

  const users = await prisma.user.findMany({
    where: { email: { in: [...emails] } },
    select: { id: true, email: true },
  });

  const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
  const missing = emails.filter((e) => !byEmail[e]);
  if (missing.length) {
    throw new Error(`Utilisateurs manquants pour le seed démo : ${missing.join(", ")}`);
  }

  return {
    admin: byEmail["admin@alwatan.local"],
    gestionnaire: byEmail["gestionnaire@alwatan.local"],
    reception: byEmail["reception@alwatan.local"],
    comptable: byEmail["direction@alwatan.local"],
    medecin: byEmail["medecin@alwatan.local"],
    medecin2: byEmail["medecin2@alwatan.local"],
    pharmacien: byEmail["pharmacie@alwatan.local"],
    laborantin: byEmail["laborantin@alwatan.local"],
  };
}

export async function cleanupDemoData() {
  const demoPatients = await prisma.patient.findMany({
    where: { code: { startsWith: DEMO_PATIENT_PREFIX } },
    select: { id: true },
  });
  const patientIds = demoPatients.map((p) => p.id);
  if (!patientIds.length) return;

  const demoInvoices = await prisma.invoice.findMany({
    where: { patientId: { in: patientIds } },
    select: { id: true },
  });
  const invoiceIds = demoInvoices.map((i) => i.id);

  await prisma.receptionCashSettlementLine.deleteMany({
    where: { invoiceId: { in: invoiceIds } },
  });
  await prisma.receptionCashSettlement.deleteMany({
    where: { comment: { contains: "[DEMO]" } },
  });
  await prisma.pharmacySaleLine.deleteMany({
    where: { OR: [{ invoiceId: { in: invoiceIds } }, { prescription: { patientId: { in: patientIds } } }] },
  });
  await prisma.prescription.deleteMany({ where: { patientId: { in: patientIds } } });
  await prisma.examReclamation.deleteMany({ where: { patientId: { in: patientIds } } });
  await prisma.invoice.deleteMany({ where: { patientId: { in: patientIds } } });
  await prisma.visit.deleteMany({ where: { patientId: { in: patientIds } } });
  await prisma.patientDossier.deleteMany({ where: { patientId: { in: patientIds } } });
  await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });

  await prisma.clinicExpense.deleteMany({ where: { label: { startsWith: "[DEMO]" } } });
  await prisma.employeePayroll.deleteMany({ where: { remarks: { startsWith: "[DEMO]" } } });
  await prisma.salaryAdvance.deleteMany({ where: { comment: { startsWith: "[DEMO]" } } });
  await prisma.cashChangeTransfer.deleteMany({ where: { comment: { contains: "[DEMO]" } } });

  const demoEmployees = await prisma.employee.findMany({
    where: { firstName: DEMO_EMPLOYEE_FIRST_NAME, lastName: { startsWith: "Salarié " } },
    select: { id: true },
  });
  if (demoEmployees.length) {
    await prisma.employee.deleteMany({
      where: { id: { in: demoEmployees.map((e) => e.id) } },
    });
  }
}

async function upsertDemoPatient(data: {
  code: string;
  firstName: string;
  lastName: string;
  category?: PatientCategory;
  age?: number;
  phone?: string;
  gender?: string;
}) {
  const category =
    data.category === PatientCategory.ONG
      ? PatientCategory.STANDARD
      : (data.category ?? PatientCategory.STANDARD);
  return prisma.patient.upsert({
    where: { code: data.code },
    update: {
      firstName: data.firstName,
      lastName: data.lastName,
      category,
      ongName: null,
      age: data.age,
      phone: data.phone,
      gender: data.gender,
    },
    create: {
      code: data.code,
      firstName: data.firstName,
      lastName: data.lastName,
      category,
      ongName: null,
      age: data.age,
      phone: data.phone,
      gender: data.gender,
    },
  });
}

async function createPaidInvoice(params: {
  invoiceNumber: string;
  patientId: string;
  visitId?: string;
  surgeryCaseId?: string;
  hospitalizationId?: string;
  type: InvoiceType;
  amountFcfa: number;
  issuedById: string;
  paidAt: Date;
  createdAt?: Date;
}) {
  return prisma.invoice.create({
    data: {
      invoiceNumber: params.invoiceNumber,
      patientId: params.patientId,
      visitId: params.visitId,
      surgeryCaseId: params.surgeryCaseId,
      hospitalizationId: params.hospitalizationId,
      type: params.type,
      amountFcfa: params.amountFcfa,
      status: InvoiceStatus.PAID,
      issuedById: params.issuedById,
      paidAt: params.paidAt,
      createdAt: params.createdAt ?? params.paidAt,
    },
  });
}

async function upsertDemoEmployee(index: number) {
  const pad = String(index).padStart(3, "0");
  const lastName = `Salarié ${pad}`;
  const existing = await prisma.employee.findFirst({
    where: { firstName: DEMO_EMPLOYEE_FIRST_NAME, lastName },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.employee.create({
    data: {
      firstName: DEMO_EMPLOYEE_FIRST_NAME,
      lastName,
      service: DEMO_SERVICES[index % DEMO_SERVICES.length],
      jobTitle: DEMO_JOB_TITLES[index % DEMO_JOB_TITLES.length],
      fixedSalaryFcfa: 120_000 + (index % 18) * 10_000,
      contractStatus: EmployeeContractStatus.ACTIF,
      active: true,
      isMedecin: false,
      phone: `+235 66 ${String(10_000 + index).slice(-5)}`,
    },
    select: { id: true },
  });
}

async function seedBulkVolumeData(params: {
  staff: StaffIds;
  patients: { id: string }[];
  year: number;
  invoiceSeqStart: number;
}) {
  const { staff, patients, year } = params;
  let invoiceSeq = params.invoiceSeqStart;

  console.log(`Création volume démo (~${DEMO_BULK_EMPLOYEE_COUNT + DEMO_BULK_SALARY_ADVANCE_COUNT + DEMO_BULK_JOURNAL_INVOICE_COUNT + DEMO_BULK_EMPLOYEE_COUNT * DEMO_BULK_PAYROLL_MONTHS} enregistrements)…`);

  const demoEmployees: { id: string }[] = [];
  for (let i = 1; i <= DEMO_BULK_EMPLOYEE_COUNT; i++) {
    demoEmployees.push(await upsertDemoEmployee(i));
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  for (const employee of demoEmployees) {
    for (let offset = 0; offset < DEMO_BULK_PAYROLL_MONTHS; offset++) {
      let month = currentMonth - offset;
      let year = currentYear;
      while (month < 1) {
        month += 12;
        year -= 1;
      }

      const grossFcfa = 120_000 + (demoEmployees.indexOf(employee) % 18) * 10_000;
      const isCurrentMonth = offset === 0;
      const status = isCurrentMonth
        ? PayrollStatus.PENDING
        : offset % 4 === 0
          ? PayrollStatus.LATE
          : PayrollStatus.PAID;

      await prisma.employeePayroll.upsert({
        where: {
          employeeId_year_month: {
            employeeId: employee.id,
            year,
            month,
          },
        },
        update: {},
        create: {
          employeeId: employee.id,
          year,
          month,
          grossFcfa,
          primeFcfa: offset % 3 === 0 ? 15_000 : 0,
          advanceDeductionFcfa: offset % 5 === 0 ? 25_000 : 0,
          status,
          paymentMethod: status === PayrollStatus.PAID ? PaymentMethod.ESPECES : undefined,
          paidAt: status === PayrollStatus.PAID ? daysAgo(offset * 28 + 5, 10, 0) : undefined,
          paidById: status === PayrollStatus.PAID ? staff.gestionnaire : undefined,
          remarks: `[DEMO] Paie ${month}/${year}`,
        },
      });
    }
  }

  for (let i = 0; i < DEMO_BULK_SALARY_ADVANCE_COUNT; i++) {
    const employee = demoEmployees[i % demoEmployees.length];
    const dayOffset = (i % 90) + 1;
    const statusCycle: SalaryAdvanceStatus[] = [
      SalaryAdvanceStatus.PENDING,
      SalaryAdvanceStatus.DEDUCTED,
      SalaryAdvanceStatus.CANCELLED,
    ];
    const status = statusCycle[i % statusCycle.length];
    const amountFcfa = 10_000 + (i % 12) * 5_000;
    const payrollMonth = status === SalaryAdvanceStatus.DEDUCTED ? currentMonth : null;
    const payrollYear = status === SalaryAdvanceStatus.DEDUCTED ? currentYear : null;

    await prisma.salaryAdvance.create({
      data: {
        employeeId: employee.id,
        amountFcfa,
        businessDate: dateOnly(dayOffset),
        comment: `[DEMO] Avance test #${String(i + 1).padStart(3, "0")}`,
        status,
        payrollYear,
        payrollMonth,
        recordedById: staff.gestionnaire,
        createdAt: daysAgo(dayOffset, 11, 0),
      },
    });
  }

  const journalInvoices: { id: string; amountFcfa: number; paidAt: Date }[] = [];
  for (let i = 0; i < DEMO_BULK_JOURNAL_INVOICE_COUNT; i++) {
    const patient = patients[i % patients.length];
    const dayOffset = (i % 120) + 1;
    const hour = 8 + (i % 10);
    const paidAt = daysAgo(dayOffset, hour, (i * 7) % 60);
    const amount = i % 5 === 0 ? 9_500 : i % 7 === 0 ? 12_000 : 5_000;

    const visit = await prisma.visit.create({
      data: {
        patientId: patient.id,
        status: VisitStatus.COMPLETED,
        assignedDoctorId: i % 2 === 0 ? staff.medecin : staff.medecin2,
        consultationFeeFcfa: amount,
        createdAt: paidAt,
      },
    });
    await prisma.consultation.create({
      data: {
        visitId: visit.id,
        doctorId: i % 2 === 0 ? staff.medecin : staff.medecin2,
        diagnosis: "Consultation démo volume",
        completedAt: paidAt,
      },
    });
    const inv = await createPaidInvoice({
      invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
      patientId: patient.id,
      visitId: visit.id,
      type: InvoiceType.CONSULTATION,
      amountFcfa: amount,
      issuedById: staff.reception,
      paidAt,
    });
    journalInvoices.push({ id: inv.id, amountFcfa: amount, paidAt });
  }

  return { invoiceSeq, journalInvoices };
}

export async function seedDemoData() {
  if (process.env.SEED_DEMO === "0") {
    console.log("Seed démo ignoré (SEED_DEMO=0).");
    return;
  }

  const existing = await prisma.patient.findFirst({
    where: { code: { startsWith: DEMO_PATIENT_PREFIX } },
    select: { id: true },
  });

  if (existing && process.env.SEED_DEMO_RESET !== "1") {
    console.log("Données démo déjà présentes — SEED_DEMO_RESET=1 pour régénérer.");
    return;
  }

  if (existing) {
    console.log("Suppression des anciennes données démo…");
    await cleanupDemoData();
  }

  const staff = await loadStaffIds();
  const year = new Date().getFullYear();

  const interventionA = await prisma.interventionType.findUnique({ where: { code: "CHIR-A" } });
  const interventionB = await prisma.interventionType.findUnique({ where: { code: "CHIR-B" } });
  const roomVip = await prisma.room.findFirst({ where: { name: "VIP 101" } });
  const roomSimple = await prisma.room.findFirst({ where: { name: "Simple A" } });
  const productPara = await prisma.product.findUnique({ where: { sku: "MED-PARA-500" } });
  const productAmox = await prisma.product.findUnique({ where: { sku: "MED-AMOX-500" } });
  const expenseCategory = await prisma.expenseCategory.findFirst({ orderBy: { sortOrder: "asc" } });

  const gestionnaireEmployee = await prisma.user.findUnique({
    where: { id: staff.gestionnaire },
    select: { employeeId: true },
  });
  const receptionEmployee = await prisma.user.findUnique({
    where: { id: staff.reception },
    select: { employeeId: true },
  });
  const comptableEmployee = await prisma.user.findUnique({
    where: { id: staff.comptable },
    select: { employeeId: true },
  });

  if (!interventionA || !interventionB || !roomVip || !roomSimple || !productPara || !productAmox) {
    throw new Error("Catalogue de base incomplet — lancez d'abord le seed principal.");
  }

  console.log("Création des patients démo…");

  const patients: Awaited<ReturnType<typeof upsertDemoPatient>>[] = await Promise.all([
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}001`, firstName: "Ahmed", lastName: "Mahamat", age: 34, phone: "66001101", gender: "M" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}002`, firstName: "Fatna", lastName: "Ali", age: 28, category: PatientCategory.STANDARD, gender: "F" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}003`, firstName: "Hassan", lastName: "Djibrine", age: 45, category: PatientCategory.ASSOCIE, gender: "M" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}004`, firstName: "Khadija", lastName: "Ousman", age: 22, gender: "F" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}005`, firstName: "Brahim", lastName: "Saleh", age: 51, gender: "M" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}006`, firstName: "Amina", lastName: "Youssouf", age: 39, gender: "F" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}007`, firstName: "Moussa", lastName: "Adam", age: 62, gender: "M" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}008`, firstName: "Zara", lastName: "Hassan", age: 19, gender: "F" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}009`, firstName: "Oumar", lastName: "Idriss", age: 8, gender: "M" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}010`, firstName: "Halima", lastName: "Mahamat", age: 31, gender: "F" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}011`, firstName: "Issa", lastName: "Abdullah", age: 55, gender: "M" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}012`, firstName: "Mariam", lastName: "Abakar", age: 27, gender: "F" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}013`, firstName: "Saleh", lastName: "Mahamat", age: 41, gender: "M" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}014`, firstName: "Hawa", lastName: "Brahim", age: 16, gender: "F" }),
    upsertDemoPatient({ code: `${DEMO_PATIENT_PREFIX}015`, firstName: "Youssouf", lastName: "Ali", age: 73, gender: "M" }),
  ]);

  for (let i = 16; i <= 50; i++) {
    const pad = String(i).padStart(3, "0");
    patients.push(
      await upsertDemoPatient({
        code: `${DEMO_PATIENT_PREFIX}${pad}`,
        firstName: DEMO_FIRST_NAMES[i % DEMO_FIRST_NAMES.length],
        lastName: DEMO_LAST_NAMES[i % DEMO_LAST_NAMES.length],
        age: 18 + (i % 55),
        phone: `6600${String(1000 + i).slice(-4)}`,
        gender: i % 2 === 0 ? "F" : "M",
        category: i % 13 === 0 ? PatientCategory.ASSOCIE : PatientCategory.STANDARD,
      }),
    );
  }

  const [pAhmed, pFatna, pHassan, pKhadija, pBrahim, pAmina, pMoussa, pZara, pOumar, pHalima, pIssa, pMariam, pSaleh, pHawa, pYoussouf] = patients;

  console.log("Création des visites et consultations…");

  // --- Réception : file d'attente + consultation en cours ---
  const visitOumar = await prisma.visit.create({
    data: {
      patientId: pOumar.id,
      status: VisitStatus.WAITING_CONSULTATION,
      assignedDoctorId: staff.medecin,
      consultationFeeFcfa: 5000,
      createdAt: daysAgo(0, 8, 15),
    },
  });

  const visitHalima = await prisma.visit.create({
    data: {
      patientId: pHalima.id,
      status: VisitStatus.IN_CONSULTATION,
      assignedDoctorId: staff.medecin,
      consultationFeeFcfa: 5000,
      createdAt: daysAgo(0, 9, 0),
    },
  });
  await prisma.consultation.create({
    data: { visitId: visitHalima.id, doctorId: staff.medecin, clinicalNotes: "Céphalées depuis 3 jours" },
  });

  // --- Consultations terminées avec factures (journal multi-jours) ---
  const journalDays = [1, 2, 3, 5, 7, 10, 14, 21, 28, 35, 42];
  let invoiceSeq = 1;
  const journalInvoices: { id: string; amountFcfa: number; paidAt: Date }[] = [];

  for (const day of journalDays) {
    const patient = day % 2 === 0 ? pAhmed : pMariam;
    const paidAt = daysAgo(day, 11, 0);
    const visit = await prisma.visit.create({
      data: {
        patientId: patient.id,
        status: VisitStatus.COMPLETED,
        assignedDoctorId: staff.medecin,
        consultationFeeFcfa: 5000,
        createdAt: paidAt,
      },
    });
    await prisma.consultation.create({
      data: {
        visitId: visit.id,
        doctorId: staff.medecin,
        diagnosis: "Consultation générale",
        completedAt: paidAt,
      },
    });
    const amount = day % 3 === 0 ? 9500 : 5000;
    const inv = await createPaidInvoice({
      invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
      patientId: patient.id,
      visitId: visit.id,
      type: InvoiceType.CONSULTATION,
      amountFcfa: amount,
      issuedById: staff.reception,
      paidAt,
    });
    journalInvoices.push({ id: inv.id, amountFcfa: amount, paidAt });
  }

  // --- Examens labo (Khadija) ---
  const visitKhadija = await prisma.visit.create({
    data: {
      patientId: pKhadija.id,
      status: VisitStatus.COMPLETED,
      assignedDoctorId: staff.medecin,
      consultationFeeFcfa: 5000,
      createdAt: daysAgo(4, 9, 0),
    },
  });
  const consultKhadija = await prisma.consultation.create({
    data: {
      visitId: visitKhadija.id,
      doctorId: staff.medecin,
      diagnosis: "Bilan biologique",
      completedAt: daysAgo(4, 10, 0),
      labSentToLabAt: daysAgo(4, 10, 30),
      labApprovedById: staff.laborantin,
    },
  });
  await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pKhadija.id,
    visitId: visitKhadija.id,
    type: InvoiceType.CONSULTATION,
    amountFcfa: 5000,
    issuedById: staff.reception,
    paidAt: daysAgo(4, 9, 15),
  });
  const examInvoice = await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pKhadija.id,
    visitId: visitKhadija.id,
    type: InvoiceType.LAB_EXAM,
    amountFcfa: 85000,
    issuedById: staff.comptable,
    paidAt: daysAgo(3, 14, 0),
  });
  journalInvoices.push({ id: examInvoice.id, amountFcfa: 85000, paidAt: daysAgo(3, 14, 0) });

  await prisma.examReclamation.create({
    data: {
      consultationId: consultKhadija.id,
      visitId: visitKhadija.id,
      patientId: pKhadija.id,
      examKind: "EXAMEN",
      examLabel: "NFS — résultat en attente",
      totalFcfa: 15000,
      reason: ExamReclamationReason.RESULT_MISSING,
      reasonDetail: "Résultat non remis au patient",
      status: ExamReclamationStatus.PENDING,
      createdById: staff.reception,
      createdAt: daysAgo(2, 16, 0),
    },
  });

  // --- Patient Fatna — consultation standard ---
  const visitFatna = await prisma.visit.create({
    data: {
      patientId: pFatna.id,
      status: VisitStatus.COMPLETED,
      assignedDoctorId: staff.medecin2,
      consultationFeeFcfa: 0,
      createdAt: daysAgo(6, 8, 30),
    },
  });
  await prisma.consultation.create({
    data: {
      visitId: visitFatna.id,
      doctorId: staff.medecin2,
      diagnosis: "Suivi MSF",
      completedAt: daysAgo(6, 9, 30),
    },
  });
  await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pFatna.id,
    visitId: visitFatna.id,
    type: InvoiceType.CONSULTATION,
    amountFcfa: 0,
    issuedById: staff.reception,
    paidAt: daysAgo(6, 8, 45),
  });

  // --- Associé (Hassan) ---
  const visitHassan = await prisma.visit.create({
    data: {
      patientId: pHassan.id,
      status: VisitStatus.COMPLETED,
      assignedDoctorId: staff.medecin,
      consultationFeeFcfa: 2500,
      reductionFcfa: 2500,
      createdAt: daysAgo(8, 10, 0),
    },
  });
  await prisma.consultation.create({
    data: {
      visitId: visitHassan.id,
      doctorId: staff.medecin,
      completedAt: daysAgo(8, 11, 0),
    },
  });
  await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pHassan.id,
    visitId: visitHassan.id,
    type: InvoiceType.CONSULTATION,
    amountFcfa: 2500,
    issuedById: staff.reception,
    paidAt: daysAgo(8, 10, 20),
  });

  console.log("Création chirurgie et hospitalisation…");

  // --- Chirurgie NOTIFIED (Brahim) ---
  const visitBrahim = await prisma.visit.create({
    data: {
      patientId: pBrahim.id,
      status: VisitStatus.NEEDS_SURGERY,
      assignedDoctorId: staff.medecin,
      createdAt: daysAgo(3, 9, 0),
    },
  });
  await prisma.consultation.create({
    data: {
      visitId: visitBrahim.id,
      doctorId: staff.medecin,
      needsSurgery: true,
      diagnosis: "Hernie inguinale",
      completedAt: daysAgo(3, 10, 0),
    },
  });
  await prisma.surgeryCase.create({
    data: {
      visitId: visitBrahim.id,
      interventionTypeId: interventionB.id,
      surgeonId: staff.medecin,
      accountantId: staff.comptable,
      totalCostFcfa: interventionB.totalCostFcfa,
      surgeonShareFcfa: Math.round(interventionB.totalCostFcfa * interventionB.surgeonPercent / 100),
      clinicShareFcfa: interventionB.totalCostFcfa - Math.round(interventionB.totalCostFcfa * interventionB.surgeonPercent / 100),
      status: SurgeryStatus.NOTIFIED,
    },
  });

  // --- Chirurgie COMPLETED + payée (Amina) ---
  const visitAminaSurgery = await prisma.visit.create({
    data: {
      patientId: pAmina.id,
      status: VisitStatus.COMPLETED,
      assignedDoctorId: staff.medecin,
      createdAt: daysAgo(15, 8, 0),
    },
  });
  await prisma.consultation.create({
    data: {
      visitId: visitAminaSurgery.id,
      doctorId: staff.medecin,
      needsSurgery: true,
      completedAt: daysAgo(15, 9, 0),
    },
  });
  const surgeryAmina = await prisma.surgeryCase.create({
    data: {
      visitId: visitAminaSurgery.id,
      interventionTypeId: interventionA.id,
      surgeonId: staff.medecin,
      accountantId: staff.comptable,
      totalCostFcfa: interventionA.totalCostFcfa,
      surgeonShareFcfa: Math.round(interventionA.totalCostFcfa * interventionA.surgeonPercent / 100),
      clinicShareFcfa: interventionA.totalCostFcfa - Math.round(interventionA.totalCostFcfa * interventionA.surgeonPercent / 100),
      status: SurgeryStatus.COMPLETED,
      paidAt: daysAgo(12, 15, 0),
      completedAt: daysAgo(11, 16, 0),
      surgeonPaidAt: daysAgo(10, 10, 0),
      surgeonPaidById: staff.gestionnaire,
    },
  });
  const surgeryInv = await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pAmina.id,
    visitId: visitAminaSurgery.id,
    surgeryCaseId: surgeryAmina.id,
    type: InvoiceType.SURGERY,
    amountFcfa: interventionA.totalCostFcfa,
    issuedById: staff.comptable,
    paidAt: daysAgo(12, 15, 0),
  });
  journalInvoices.push({ id: surgeryInv.id, amountFcfa: interventionA.totalCostFcfa, paidAt: daysAgo(12, 15, 0) });

  // --- Hospitalisation ACTIVE (Moussa) ---
  const visitMoussa = await prisma.visit.create({
    data: {
      patientId: pMoussa.id,
      status: VisitStatus.IN_TREATMENT,
      assignedDoctorId: staff.medecin,
      createdAt: daysAgo(2, 7, 0),
    },
  });
  await prisma.consultation.create({
    data: {
      visitId: visitMoussa.id,
      doctorId: staff.medecin,
      needsHospitalization: true,
      diagnosis: "Pneumonie",
      completedAt: daysAgo(2, 8, 0),
    },
  });
  const hospMoussa = await prisma.hospitalization.create({
    data: {
      visitId: visitMoussa.id,
      roomId: roomVip.id,
      accountantId: staff.comptable,
      roomType: roomVip.type,
      dailyRateFcfa: roomVip.dailyRateFcfa,
      depositFcfa: 150000,
      nightsCount: 2,
      totalDueFcfa: 150000,
      status: HospitalizationStatus.ACTIVE,
      startDate: daysAgo(2, 12, 0),
      service: "Médecine",
      attendingDoctor: "Dr Ibrahim Mahamat",
    },
  });
  await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pMoussa.id,
    visitId: visitMoussa.id,
    hospitalizationId: hospMoussa.id,
    type: InvoiceType.HOSPITALIZATION_DEPOSIT,
    amountFcfa: 150000,
    issuedById: staff.comptable,
    paidAt: daysAgo(2, 12, 30),
  });

  // --- Hospitalisation DISCHARGED (Zara) ---
  const visitZara = await prisma.visit.create({
    data: {
      patientId: pZara.id,
      status: VisitStatus.COMPLETED,
      assignedDoctorId: staff.medecin2,
      createdAt: daysAgo(20, 9, 0),
    },
  });
  await prisma.consultation.create({
    data: {
      visitId: visitZara.id,
      doctorId: staff.medecin2,
      needsHospitalization: true,
      completedAt: daysAgo(20, 10, 0),
    },
  });
  const hospZara = await prisma.hospitalization.create({
    data: {
      visitId: visitZara.id,
      roomId: roomSimple.id,
      accountantId: staff.comptable,
      roomType: roomSimple.type,
      dailyRateFcfa: roomSimple.dailyRateFcfa,
      depositFcfa: 50000,
      nightsCount: 3,
      totalDueFcfa: 120000,
      status: HospitalizationStatus.DISCHARGED,
      startDate: daysAgo(18, 14, 0),
      endDate: daysAgo(15, 10, 0),
      dischargedAt: daysAgo(15, 10, 0),
      paidAt: daysAgo(15, 11, 0),
    },
  });
  await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pZara.id,
    visitId: visitZara.id,
    hospitalizationId: hospZara.id,
    type: InvoiceType.HOSPITALIZATION_DEPOSIT,
    amountFcfa: 50000,
    issuedById: staff.comptable,
    paidAt: daysAgo(18, 14, 30),
  });
  const hospFinalInv = await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pZara.id,
    visitId: visitZara.id,
    hospitalizationId: hospZara.id,
    type: InvoiceType.HOSPITALIZATION_FINAL,
    amountFcfa: 120000,
    issuedById: staff.comptable,
    paidAt: daysAgo(15, 11, 0),
  });
  journalInvoices.push({ id: hospFinalInv.id, amountFcfa: 120000, paidAt: daysAgo(15, 11, 0) });

  // --- Constantes vitales (Saleh) ---
  const visitSaleh = await prisma.visit.create({
    data: {
      patientId: pSaleh.id,
      status: VisitStatus.COMPLETED,
      assignedDoctorId: staff.medecin,
      consultationFeeFcfa: 5000,
      createdAt: daysAgo(1, 8, 0),
    },
  });
  await prisma.vitalSign.create({
    data: {
      visitId: visitSaleh.id,
      patientId: pSaleh.id,
      weightKg: 78,
      bloodPressure: "130/85",
      temperatureC: 37.2,
      pulseBpm: 82,
      recordedById: staff.reception,
      recordedAt: daysAgo(1, 8, 10),
    },
  });
  await prisma.consultation.create({
    data: {
      visitId: visitSaleh.id,
      doctorId: staff.medecin,
      completedAt: daysAgo(1, 9, 0),
    },
  });
  await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pSaleh.id,
    visitId: visitSaleh.id,
    type: InvoiceType.CONSULTATION,
    amountFcfa: 5000,
    issuedById: staff.reception,
    paidAt: daysAgo(1, 8, 20),
  });

  console.log("Création pharmacie…");

  // --- Pharmacie (Issa) ---
  const visitIssa = await prisma.visit.create({
    data: {
      patientId: pIssa.id,
      status: VisitStatus.COMPLETED,
      assignedDoctorId: staff.medecin,
      createdAt: daysAgo(5, 11, 0),
    },
  });
  await prisma.consultation.create({
    data: {
      visitId: visitIssa.id,
      doctorId: staff.medecin,
      completedAt: daysAgo(5, 12, 0),
    },
  });
  const pharmaInv = await createPaidInvoice({
    invoiceNumber: `DEMO-FAC-${year}-${String(invoiceSeq++).padStart(4, "0")}`,
    patientId: pIssa.id,
    visitId: visitIssa.id,
    type: InvoiceType.PHARMACY,
    amountFcfa: 12500,
    issuedById: staff.pharmacien,
    paidAt: daysAgo(5, 13, 0),
  });
  const prescription = await prisma.prescription.create({
    data: {
      patientId: pIssa.id,
      visitId: visitIssa.id,
      pharmacistId: staff.pharmacien,
      notes: "Antibiotique 7 jours",
    },
  });
  await prisma.pharmacySaleLine.createMany({
    data: [
      {
        prescriptionId: prescription.id,
        productId: productAmox.id,
        invoiceId: pharmaInv.id,
        quantity: 2,
        unitPriceFcfa: productAmox.unitPriceFcfa,
        lineTotalFcfa: productAmox.unitPriceFcfa * 2,
      },
      {
        prescriptionId: prescription.id,
        productId: productPara.id,
        invoiceId: pharmaInv.id,
        quantity: 1,
        unitPriceFcfa: productPara.unitPriceFcfa,
        lineTotalFcfa: productPara.unitPriceFcfa,
      },
    ],
  });

  // --- Dossier patient (Hawa) ---
  await prisma.patientDossier.create({ data: { patientId: pHawa.id } });

  console.log("Création caisse, dépenses et paie…");

  // --- Décaissements réception + comptable (journal) ---
  const settlementBusinessDate = dateOnly(3);
  const receptionInvoices = journalInvoices.filter((_, i) => i < 5);
  const receptionTotal = receptionInvoices.reduce((s, i) => s + i.amountFcfa, 0);

  if (receptionTotal > 0) {
    const settlement = await prisma.receptionCashSettlement.create({
      data: {
        receptionistId: staff.reception,
        accountantId: staff.gestionnaire,
        businessDate: settlementBusinessDate,
        shiftSlot: ReceptionShiftSlot.MORNING,
        systemTotalFcfa: receptionTotal,
        physicalCashFcfa: receptionTotal,
        disbursementFcfa: receptionTotal,
        varianceFcfa: 0,
        isCoherent: true,
        comment: "[DEMO] Décaissement réception matin",
        settledAt: daysAgo(3, 14, 0),
      },
    });
    for (const inv of receptionInvoices) {
      await prisma.receptionCashSettlementLine.create({
        data: { settlementId: settlement.id, invoiceId: inv.id },
      });
    }
  }

  const comptableSettlementDate = dateOnly(2);
  const comptableTotal = 264500;
  await prisma.receptionCashSettlement.create({
    data: {
      receptionistId: staff.comptable,
      accountantId: staff.gestionnaire,
      businessDate: comptableSettlementDate,
      shiftSlot: ReceptionShiftSlot.EVENING,
      systemTotalFcfa: comptableTotal,
      physicalCashFcfa: comptableTotal,
      disbursementFcfa: comptableTotal,
      varianceFcfa: 0,
      isCoherent: true,
      comment: "[DEMO] Décaissement tirelire comptable",
      settledAt: daysAgo(2, 22, 30),
    },
  });

  // --- Dépenses clinique ---
  const expenseRows = [
    { days: 1, amount: 45000, label: "[DEMO] Fournitures bureau", category: ClinicExpenseCategory.FOURNITURES, status: ClinicExpenseStatus.VALIDATED },
    { days: 4, amount: 28000, label: "[DEMO] Transport médical", category: ClinicExpenseCategory.TRANSPORT, status: ClinicExpenseStatus.VALIDATED },
    { days: 6, amount: 120000, label: "[DEMO] Maintenance climatisation", category: ClinicExpenseCategory.MAINTENANCE, status: ClinicExpenseStatus.VALIDATED },
    { days: 2, amount: 35000, label: "[DEMO] Achat urgent consommables", category: ClinicExpenseCategory.ACHAT_URGENT, status: ClinicExpenseStatus.PENDING },
    { days: 9, amount: 15000, label: "[DEMO] Autre dépense", category: ClinicExpenseCategory.AUTRE, status: ClinicExpenseStatus.REJECTED },
  ];

  for (const row of expenseRows) {
    const validated = row.status === ClinicExpenseStatus.VALIDATED;
    await prisma.clinicExpense.create({
      data: {
        businessDate: dateOnly(row.days),
        amountFcfa: row.amount,
        label: row.label,
        category: row.category,
        expenseCategoryId: expenseCategory?.id,
        status: row.status,
        paymentMethod: PaymentMethod.ESPECES,
        paidById: staff.reception,
        recordedById: staff.reception,
        validatedById: validated ? staff.gestionnaire : undefined,
        validatedAt: validated ? daysAgo(row.days, 17, 0) : undefined,
        rejectionReason: row.status === ClinicExpenseStatus.REJECTED ? "Justificatif manquant" : undefined,
        createdAt: daysAgo(row.days, 16, 0),
      },
    });
  }

  // --- Fiches de paie ---
  const now = new Date();
  const payrollMonth = now.getMonth() + 1;
  const payrollYear = now.getFullYear();
  const prevMonth = payrollMonth === 1 ? 12 : payrollMonth - 1;
  const prevYear = payrollMonth === 1 ? payrollYear - 1 : payrollYear;

  if (receptionEmployee?.employeeId) {
    await prisma.employeePayroll.upsert({
      where: {
        employeeId_year_month: {
          employeeId: receptionEmployee.employeeId,
          year: payrollYear,
          month: payrollMonth,
        },
      },
      update: {},
      create: {
        employeeId: receptionEmployee.employeeId,
        year: payrollYear,
        month: payrollMonth,
        grossFcfa: 180000,
        primeFcfa: 15000,
        status: PayrollStatus.PENDING,
        remarks: "[DEMO] Paie réception en attente",
      },
    });
  }

  if (comptableEmployee?.employeeId) {
    await prisma.employeePayroll.upsert({
      where: {
        employeeId_year_month: {
          employeeId: comptableEmployee.employeeId,
          year: prevYear,
          month: prevMonth,
        },
      },
      update: {},
      create: {
        employeeId: comptableEmployee.employeeId,
        year: prevYear,
        month: prevMonth,
        grossFcfa: 220000,
        primeFcfa: 20000,
        status: PayrollStatus.PAID,
        paymentMethod: PaymentMethod.VIREMENT,
        paidAt: daysAgo(25, 10, 0),
        paidById: staff.gestionnaire,
        remarks: "[DEMO] Paie comptable validée",
      },
    });
  }

  if (gestionnaireEmployee?.employeeId) {
    await prisma.employeePayroll.upsert({
      where: {
        employeeId_year_month: {
          employeeId: gestionnaireEmployee.employeeId,
          year: payrollYear,
          month: payrollMonth,
        },
      },
      update: {},
      create: {
        employeeId: gestionnaireEmployee.employeeId,
        year: payrollYear,
        month: payrollMonth,
        grossFcfa: 350000,
        primeFcfa: 50000,
        status: PayrollStatus.LATE,
        remarks: "[DEMO] Paie gestionnaire en retard",
      },
    });
  }

  // --- Coupure de monnaie ---
  await prisma.cashChangeTransfer.create({
    data: {
      businessDate: dateOnly(1),
      requesterId: staff.reception,
      providerId: staff.comptable,
      amountFcfa: 5000,
      patientHint: "Patient DEMO-PAT-013",
      comment: "[DEMO] Monnaie reçue au comptable",
      recordedById: staff.reception,
      createdAt: daysAgo(1, 11, 30),
    },
  });

  // --- Examen réclamation traitée (Youssouf) ---
  const visitYoussouf = await prisma.visit.create({
    data: {
      patientId: pYoussouf.id,
      status: VisitStatus.COMPLETED,
      assignedDoctorId: staff.medecin,
      createdAt: daysAgo(12, 9, 0),
    },
  });
  const consultYoussouf = await prisma.consultation.create({
    data: {
      visitId: visitYoussouf.id,
      doctorId: staff.medecin,
      completedAt: daysAgo(12, 10, 0),
      labSentToLabAt: daysAgo(12, 10, 30),
    },
  });
  await prisma.examReclamation.create({
    data: {
      consultationId: consultYoussouf.id,
      visitId: visitYoussouf.id,
      patientId: pYoussouf.id,
      examLabel: "Glycémie",
      totalFcfa: 8000,
      reason: ExamReclamationReason.ERROR,
      reasonDetail: "Double facturation corrigée",
      status: ExamReclamationStatus.REFUNDED,
      createdById: staff.reception,
      handledById: staff.comptable,
      resolvedAt: daysAgo(10, 15, 0),
      createdAt: daysAgo(11, 9, 0),
    },
  });

  // --- Logs audit ---
  await prisma.auditLog.createMany({
    data: [
      {
        userId: staff.gestionnaire,
        action: "DEMO_SEED",
        entity: "Patient",
        entityId: pAhmed.id,
        metadata: { note: "Jeu de données démo généré" },
        createdAt: daysAgo(0, 6, 0),
      },
      {
        userId: staff.comptable,
        action: "INVOICE_PAID",
        entity: "Invoice",
        metadata: { demo: true, type: "LAB_EXAM" },
        createdAt: daysAgo(3, 14, 0),
      },
    ],
  });

  const bulk = await seedBulkVolumeData({
    staff,
    patients,
    year,
    invoiceSeqStart: invoiceSeq,
  });
  invoiceSeq = bulk.invoiceSeq;
  journalInvoices.push(...bulk.journalInvoices);

  const payrollDemoCount = await prisma.employeePayroll.count({
    where: { remarks: { startsWith: "[DEMO]" } },
  });
  const advanceDemoCount = await prisma.salaryAdvance.count({
    where: { comment: { startsWith: "[DEMO]" } },
  });
  const employeeDemoCount = await prisma.employee.count({
    where: { firstName: DEMO_EMPLOYEE_FIRST_NAME, lastName: { startsWith: "Salarié " } },
  });

  console.log("Données démo créées :");
  console.log(`  · ${patients.length} patients (${DEMO_PATIENT_PREFIX}*)`);
  console.log(`  · ${invoiceSeq - 1} factures DEMO-FAC-${year}-*`);
  console.log(`  · ${employeeDemoCount} employés démo (Démo Salarié ###)`);
  console.log(`  · ${payrollDemoCount} fiches de paie [DEMO]`);
  console.log(`  · ${advanceDemoCount} avances sur salaire [DEMO]`);
  console.log("  · Visites (attente, consultation, chirurgie, hospitalisation)");
  console.log("  · Décaissements, dépenses, pharmacie, réclamations labo");
}
