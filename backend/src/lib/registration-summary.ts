import { ConsultationQuotaMode, InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import {
  classifyInvoiceForDayClosure,
  type DayClosureLineGroup,
} from "./day-closure-sales.js";
import {
  computeConsultationShares,
  doctorUsesQuota,
  type DoctorProfile,
} from "./doctor-compensation.js";
import { COLLECTED_INVOICE_TYPES } from "./revenue-stats.js";

/** Une ligne du PDF des enregistrements : un service dans une section. */
export type RegistrationSummaryLine = {
  group: DayClosureLineGroup;
  service: string;
  qty: number;
  amountFcfa: number;
  doctorShareFcfa: number;
  /** null quand les factures de la ligne n'ont pas toutes le même taux. */
  doctorPercent: number | null;
  operationPercent: number | null;
};

const compensationSelect = {
  isMedecin: true,
  doctorCompensationType: true,
  consultationTotalFcfa: true,
  consultationQuotaMode: true,
  consultationQuotaPercent: true,
  consultationQuotaFcfa: true,
  surgeryQuotaPercent: true,
} satisfies Prisma.EmployeeSelect;

const doctorSelect = {
  select: { role: true, employee: { select: compensationSelect } },
} as const;

const summaryInvoiceSelect = {
  id: true,
  patientId: true,
  type: true,
  amountFcfa: true,
  paidAmountFcfa: true,
  billingExamKind: true,
  surgeryCaseId: true,
  hospitalizationId: true,
  visit: {
    select: {
      reductionFcfa: true,
      consultationFeeFcfa: true,
      assignedClinicService: { select: { name: true } },
      assignedDoctor: doctorSelect,
      patient: { select: { service: true } },
      consultation: { select: { clinicalNotes: true, doctor: doctorSelect } },
    },
  },
  hospitalization: { select: { reductionFcfa: true } },
  surgeryCase: {
    select: {
      surgeonShareFcfa: true,
      totalCostFcfa: true,
      interventionType: { select: { clinicService: { select: { name: true } } } },
    },
  },
} satisfies Prisma.InvoiceSelect;

type SummaryInvoice = Prisma.InvoiceGetPayload<{ select: typeof summaryInvoiceSelect }>;

/** Montant retenu : ce qui a été encaissé, sinon le montant facturé. */
function summaryAmountFcfa(invoice: SummaryInvoice): number {
  const paid = Math.max(0, invoice.paidAmountFcfa ?? 0);
  return paid > 0 ? paid : Math.max(0, invoice.amountFcfa);
}

function invoiceDoctor(invoice: SummaryInvoice): DoctorProfile | null {
  return invoice.visit?.consultation?.doctor ?? invoice.visit?.assignedDoctor ?? null;
}

type ShareResult = { shareFcfa: number; percent: number | null };

const NO_SHARE: ShareResult = { shareFcfa: 0, percent: null };

function consultationShare(invoice: SummaryInvoice, amountFcfa: number): ShareResult {
  const doctor = invoiceDoctor(invoice);
  if (!doctor || !doctorUsesQuota(doctor)) return NO_SHARE;

  const quotaMode = doctor.employee?.consultationQuotaMode ?? ConsultationQuotaMode.PERCENT;
  const quotaPercent = doctor.employee?.consultationQuotaPercent ?? 0;
  const { doctorShareFcfa } = computeConsultationShares(
    amountFcfa,
    quotaPercent,
    doctor.employee?.consultationQuotaFcfa,
    quotaMode,
    doctor,
  );
  // Montant fixe : le taux affiché n'a pas de sens, seul le montant compte.
  const percent = quotaMode === ConsultationQuotaMode.PERCENT ? quotaPercent : null;
  return { shareFcfa: doctorShareFcfa, percent };
}

function operationShare(invoice: SummaryInvoice, amountFcfa: number): ShareResult {
  const stored = invoice.surgeryCase?.surgeonShareFcfa;
  if (stored != null && stored > 0) {
    const total = invoice.surgeryCase?.totalCostFcfa ?? 0;
    return {
      shareFcfa: stored,
      percent: total > 0 ? Math.round((stored * 100) / total) : null,
    };
  }
  // Opération hors bloc : pas de part enregistrée, on applique le quota du chirurgien.
  const doctor = invoiceDoctor(invoice);
  if (!doctor || !doctorUsesQuota(doctor)) return NO_SHARE;
  const percent = doctor.employee?.surgeryQuotaPercent ?? 0;
  if (percent <= 0) return NO_SHARE;
  return { shareFcfa: Math.round((amountFcfa * percent) / 100), percent };
}

function invoiceShare(
  invoice: SummaryInvoice,
  group: DayClosureLineGroup,
  amountFcfa: number,
): ShareResult {
  if (group === "consultation") return consultationShare(invoice, amountFcfa);
  if (group === "operation") return operationShare(invoice, amountFcfa);
  return NO_SHARE;
}

type Accumulator = RegistrationSummaryLine & {
  patientIds: Set<string>;
  doctorPercents: Set<number>;
  operationPercents: Set<number>;
};

/** Un seul taux dans la ligne : on l'affiche ; sinon la colonne reste vide. */
function uniquePercent(percents: Set<number>): number | null {
  return percents.size === 1 ? [...percents][0] : null;
}

export type RegistrationSummaryOptions = {
  /** Périmètre patients déjà calculé par l'appelant (réceptionniste, service…). */
  patientWhere: Prisma.PatientWhereInput;
};

/**
 * Cumul des prestations des patients enregistrés sur la période, par section
 * puis par service — même découpage que le ticket de clôture.
 */
export async function buildRegistrationSummary(
  options: RegistrationSummaryOptions,
): Promise<RegistrationSummaryLine[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      type: { in: COLLECTED_INVOICE_TYPES },
      status: { not: InvoiceStatus.CANCELLED },
      patient: options.patientWhere,
    },
    select: summaryInvoiceSelect,
  });

  const grouped = new Map<string, Accumulator>();

  for (const invoice of invoices) {
    const amountFcfa = summaryAmountFcfa(invoice);
    if (amountFcfa <= 0) continue;

    const { label, group } = classifyInvoiceForDayClosure(invoice);
    const key = `${group}\u0000${label}`;
    const row: Accumulator = grouped.get(key) ?? {
      group,
      service: label,
      qty: 0,
      amountFcfa: 0,
      doctorShareFcfa: 0,
      doctorPercent: null,
      operationPercent: null,
      patientIds: new Set<string>(),
      doctorPercents: new Set<number>(),
      operationPercents: new Set<number>(),
    };

    const patientKey = invoice.patientId ?? invoice.id;
    if (!row.patientIds.has(patientKey)) {
      row.patientIds.add(patientKey);
      row.qty += 1;
    }
    row.amountFcfa += amountFcfa;

    const share = invoiceShare(invoice, group, amountFcfa);
    row.doctorShareFcfa += share.shareFcfa;
    if (share.percent != null) {
      if (group === "operation") row.operationPercents.add(share.percent);
      else row.doctorPercents.add(share.percent);
    }

    grouped.set(key, row);
  }

  return [...grouped.values()]
    .map(({ patientIds: _patientIds, doctorPercents, operationPercents, ...line }) => ({
      ...line,
      doctorPercent: uniquePercent(doctorPercents),
      operationPercent: uniquePercent(operationPercents),
    }))
    .sort((a, b) => a.service.localeCompare(b.service, "fr", { sensitivity: "base" }));
}
