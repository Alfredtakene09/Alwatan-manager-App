/**
 * Audit des flux et des exports de tous les modules, sur les données réelles.
 * Lecture seule : rien n'est modifié.
 *
 *   npx tsx scripts/audit-flows.ts                 (mois en cours)
 *   npx tsx scripts/audit-flows.ts 2026-10-01 2026-10-25
 *
 * Chaque contrôle affiche OK ou la liste des écarts. Code de sortie 1 s'il y a des écarts.
 * Les « données manquantes » (ex. opération sans médecin) sont signalées à part :
 * ce sont des dossiers à compléter, pas des erreurs de calcul.
 */
import {
  ClinicExpenseFlow,
  ClinicExpenseStatus,
  InvoiceStatus,
  PayrollStatus,
  SalaryAdvanceStatus,
} from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { buildFinancialKpis, resolveDashboardDateRange } from "../src/lib/admin-dashboard-stats.js";
import { buildRegistrationSummary } from "../src/lib/registration-summary.js";
import { toBusinessDateBound } from "../src/lib/cash-shift.js";
import { payrollMonthsStartingIn } from "../src/lib/payroll-outflow.js";

const [fromArg, toArg] = process.argv.slice(2);
const range = resolveDashboardDateRange({ from: fromArg, to: toArg ?? fromArg });

type Result = { name: string; errors: string[]; missing: string[] };
const results: Result[] = [];

async function check(name: string, run: (r: Result) => Promise<void>) {
  const result: Result = { name, errors: [], missing: [] };
  try {
    await run(result);
  } catch (error) {
    result.errors.push(`contrôle impossible : ${(error as Error).message}`);
  }
  results.push(result);
}

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F`;

// 1. Factures : montants payés cohérents avec le statut et les versements.
await check("Factures — montant payé, statut et versements", async (r) => {
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: InvoiceStatus.CANCELLED }, createdAt: { gte: range.from, lt: range.toExclusive } },
    select: {
      invoiceNumber: true,
      amountFcfa: true,
      paidAmountFcfa: true,
      status: true,
      payments: { select: { amountFcfa: true } },
    },
  });
  for (const inv of invoices) {
    if (inv.paidAmountFcfa < 0 || inv.paidAmountFcfa > inv.amountFcfa) {
      r.errors.push(`${inv.invoiceNumber} : payé ${fcfa(inv.paidAmountFcfa)} hors de [0, ${fcfa(inv.amountFcfa)}]`);
    }
    if (inv.status === InvoiceStatus.PAID && inv.amountFcfa > 0 && inv.paidAmountFcfa !== inv.amountFcfa) {
      r.errors.push(`${inv.invoiceNumber} : statut PAYÉ mais ${fcfa(inv.paidAmountFcfa)} / ${fcfa(inv.amountFcfa)}`);
    }
    if (inv.payments.length) {
      const sum = inv.payments.reduce((total, p) => total + p.amountFcfa, 0);
      if (sum !== inv.paidAmountFcfa) {
        r.errors.push(`${inv.invoiceNumber} : versements ${fcfa(sum)} ≠ payé ${fcfa(inv.paidAmountFcfa)}`);
      }
    }
  }
});

// 2. Cumul des enregistrements (ticket 80 mm et PDF), jour par jour.
await check("Cumul des enregistrements — ticket et PDF", async (r) => {
  for (let day = new Date(range.from); day < range.toExclusive; day.setDate(day.getDate() + 1)) {
    const start = new Date(day);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const lines = await buildRegistrationSummary({
      patientWhere: { active: true, createdAt: { gte: start, lt: next } },
      receptionistId: null,
      period: { from: start, to: next },
    });
    const label = start.toLocaleDateString("fr-FR");
    for (const line of lines) {
      const where = `${label} [${line.group}] ${line.service}`;
      if (line.doctorShareFcfa > 0 && !line.doctorNames.length) {
        r.missing.push(`${where} : part médecins ${fcfa(line.doctorShareFcfa)}, aucun médecin dans le dossier`);
      }
      if (line.doctorShares.length) {
        const sum = line.doctorShares.reduce((total, e) => total + e.shareFcfa, 0);
        if (sum !== line.doctorShareFcfa) {
          r.errors.push(`${where} : parts par médecin ${fcfa(sum)} ≠ ${fcfa(line.doctorShareFcfa)}`);
        }
      }
      if (line.doctorShareFcfa + line.clinicShareFcfa !== line.amountFcfa) {
        r.errors.push(`${where} : médecins + clinique ≠ montant ${fcfa(line.amountFcfa)}`);
      }
    }
  }
});

// 3. Tableau de bord : cartes Sortie / Entrée = dépenses validées + paie nette (mois de paie)
//    + avances versées sur la période.
await check("Tableau de bord — cartes Sortie / Entrée", async (r) => {
  const kpis = await buildFinancialKpis(new Date(), range);
  const expenses = await prisma.clinicExpense.findMany({
    where: {
      status: ClinicExpenseStatus.VALIDATED,
      businessDate: { gte: toBusinessDateBound(range.from), lt: toBusinessDateBound(range.toExclusive) },
    },
    select: { amountFcfa: true, flow: true },
  });
  const months = payrollMonthsStartingIn(range.from, range.toExclusive);
  const payroll = months.length
    ? await prisma.employeePayroll.findMany({
        where: { status: PayrollStatus.PAID, OR: months },
        select: { grossFcfa: true, primeFcfa: true, advanceDeductionFcfa: true },
      })
    : [];
  const advances = await prisma.salaryAdvance.findMany({
    where: {
      status: { not: "CANCELLED" },
      businessDate: { gte: toBusinessDateBound(range.from), lt: toBusinessDateBound(range.toExclusive) },
    },
    select: { amountFcfa: true },
  });
  const sorties =
    expenses.filter((e) => e.flow !== ClinicExpenseFlow.ENTREE).reduce((s, e) => s + e.amountFcfa, 0) +
    payroll.reduce((s, p) => s + Math.max(0, p.grossFcfa + p.primeFcfa - p.advanceDeductionFcfa), 0) +
    advances.reduce((s, a) => s + a.amountFcfa, 0);
  const entrees = expenses.filter((e) => e.flow === ClinicExpenseFlow.ENTREE).reduce((s, e) => s + e.amountFcfa, 0);
  if (kpis.expensesMonthFcfa !== sorties) {
    r.errors.push(`carte Sortie ${fcfa(kpis.expensesMonthFcfa)} ≠ dépenses + paie ${fcfa(sorties)}`);
  }
  if ((kpis.entriesMonthFcfa ?? 0) !== entrees) {
    r.errors.push(`carte Entrée ${fcfa(kpis.entriesMonthFcfa ?? 0)} ≠ entrées ${fcfa(entrees)}`);
  }
});

// 4. Paie et avances.
await check("Salaires — paies versées et avances", async (r) => {
  const paid = await prisma.employeePayroll.findMany({
    where: { status: PayrollStatus.PAID },
    select: { grossFcfa: true, primeFcfa: true, advanceDeductionFcfa: true, year: true, month: true, employee: { select: { firstName: true, lastName: true } } },
  });
  for (const row of paid) {
    if (row.advanceDeductionFcfa > row.grossFcfa + row.primeFcfa) {
      r.errors.push(
        `${row.employee.firstName} ${row.employee.lastName} ${row.month}/${row.year} : avance ${fcfa(row.advanceDeductionFcfa)} > dû ${fcfa(row.grossFcfa + row.primeFcfa)}`,
      );
    }
  }
  const advances = await prisma.salaryAdvance.findMany({
    select: { amountFcfa: true, remainingFcfa: true, status: true, employee: { select: { firstName: true, lastName: true } } },
  });
  for (const a of advances) {
    const who = `${a.employee.firstName} ${a.employee.lastName}`;
    if (a.remainingFcfa < 0 || a.remainingFcfa > a.amountFcfa) {
      r.errors.push(`${who} : reste ${fcfa(a.remainingFcfa)} hors de [0, ${fcfa(a.amountFcfa)}]`);
    }
    if (a.status === SalaryAdvanceStatus.DEDUCTED && a.remainingFcfa !== 0) {
      r.errors.push(`${who} : avance soldée mais reste ${fcfa(a.remainingFcfa)}`);
    }
  }
});

// 5. Pharmacie : facture = montant net de la vente.
await check("Pharmacie — ventes et factures", async (r) => {
  const sales = await prisma.prescription.findMany({
    where: { createdAt: { gte: range.from, lt: range.toExclusive }, netTotalFcfa: { not: null } },
    select: {
      id: true,
      grossTotalFcfa: true,
      netTotalFcfa: true,
      saleLines: { select: { lineTotalFcfa: true, invoice: { select: { id: true, amountFcfa: true, status: true } } } },
    },
  });
  for (const sale of sales) {
    const net = sale.netTotalFcfa ?? 0;
    if (sale.grossTotalFcfa != null && net > sale.grossTotalFcfa) {
      r.errors.push(`vente ${sale.id} : net ${fcfa(net)} > brut ${fcfa(sale.grossTotalFcfa)}`);
    }
    const invoice = sale.saleLines.find((line) => line.invoice)?.invoice;
    if (invoice && invoice.status !== InvoiceStatus.CANCELLED && invoice.amountFcfa !== net) {
      r.errors.push(`vente ${sale.id} : facture ${fcfa(invoice.amountFcfa)} ≠ net ${fcfa(net)}`);
    }
  }
});

// 6. Examens payés : un médecin à afficher dans l'export.
await check("Examens payés — médecin affiché dans l'export", async (r) => {
  const rows = await prisma.consultation.findMany({
    where: {
      updatedAt: { gte: range.from, lt: range.toExclusive },
      visit: { invoices: { some: { type: "LAB_EXAM", status: InvoiceStatus.PAID } } },
    },
    select: {
      doctorId: true,
      visit: { select: { assignedDoctorId: true, notes: true, patient: { select: { code: true } } } },
    },
  });
  // Les examens n'ont pas de part médecin : sans prescripteur, l'export indique « Patient externe — Réception ».
  const withoutDoctor = rows.filter((row) => !row.doctorId && !row.visit.assignedDoctorId).length;
  if (withoutDoctor) {
    r.missing.push(`${withoutDoctor} examen(s) sans prescripteur (patients externes) — aucune part médecin concernée`);
  }
});

// 7. Opérations : une part anesthésiste doit avoir un nom.
await check("Opérations — anesthésiste nommé quand il a une part", async (r) => {
  const cases = await prisma.surgeryCase.findMany({
    where: { createdAt: { gte: range.from, lt: range.toExclusive } },
    select: {
      anesthesiologistPercent: true,
      anesthesiologistId: true,
      visit: { select: { patient: { select: { code: true } } } },
      interventionType: {
        select: { label: true, anesthesiologistPercent: true, anesthesiologistId: true, anesthesiologistName: true },
      },
    },
  });
  for (const c of cases) {
    const percent = c.anesthesiologistPercent ?? c.interventionType.anesthesiologistPercent ?? 0;
    const named =
      c.anesthesiologistPercent != null
        ? !!c.anesthesiologistId
        : !!c.interventionType.anesthesiologistId || !!c.interventionType.anesthesiologistName?.trim();
    if (percent > 0 && !named) {
      r.missing.push(`${c.visit.patient.code} ${c.interventionType.label} : ${percent} % sans anesthésiste nommé`);
    }
  }
});

console.log(`Audit du ${range.fromIso} au ${range.toIso}\n`);
let errorCount = 0;
for (const result of results) {
  const status = result.errors.length ? `✖ ${result.errors.length} écart(s)` : "✔ OK";
  const missing = result.missing.length ? ` — ${result.missing.length} dossier(s) incomplet(s)` : "";
  console.log(`${status}  ${result.name}${missing}`);
  for (const line of result.errors.slice(0, 15)) console.log(`     écart : ${line}`);
  if (result.errors.length > 15) console.log(`     … ${result.errors.length - 15} autre(s)`);
  for (const line of result.missing.slice(0, 8)) console.log(`     à compléter : ${line}`);
  if (result.missing.length > 8) console.log(`     … ${result.missing.length - 8} autre(s)`);
  errorCount += result.errors.length;
}
await prisma.$disconnect();
process.exit(errorCount ? 1 : 0);
