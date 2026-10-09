import {
  ConsultationQuotaMode,
  DoctorCompensationType,
  DoctorOvertimeStatus,
  DoctorShareClaimStatus,
  DoctorShareKind,
  InvoiceStatus,
  InvoiceType,
  PayrollStatus,
  Prisma,
  SurgeryStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "./db.js";
import { currentPayrollPeriod, employeeGrossSalary } from "./admin-payroll.js";
import { computeConsultationAmounts } from "./consultation-amounts.js";
import {
  computeConsultationShares,
  computeSurgeryShares,
  doctorSurgeryQuotaPercent,
  isMedecin,
  resolveAssistantPercent,
  resolveDoctorConsultationAmount,
  resolveSurgeonPercent,
  type DoctorProfile,
} from "./doctor-compensation.js";
import { computeOvertimeAmountFcfa } from "./doctor-overtime.js";
import { collectedAmountFcfa } from "./surgery-cost-shares.js";
import { nextConsultationInvoiceState, scaledPaymentAmounts } from "./recorded-tariff.js";

export type CompensationRecalcSummary = {
  pendingConsultationInvoices: number;
  unpaidSurgeryShares: number;
  pendingShareClaims: number;
  pendingPayrolls: number;
  pendingOvertime: number;
};

const emptySummary = (): CompensationRecalcSummary => ({
  pendingConsultationInvoices: 0,
  unpaidSurgeryShares: 0,
  pendingShareClaims: 0,
  pendingPayrolls: 0,
  pendingOvertime: 0,
});

export function compensationRecalcTouched(summary: CompensationRecalcSummary) {
  return (
    summary.pendingConsultationInvoices +
      summary.unpaidSurgeryShares +
      summary.pendingShareClaims +
      summary.pendingPayrolls +
      summary.pendingOvertime >
    0
  );
}

const FINANCIAL_KEYS = [
  "isMedecin",
  "jobTitle",
  "doctorCompensationType",
  "consultationTotalFcfa",
  "consultationQuotaMode",
  "consultationQuotaPercent",
  "consultationQuotaFcfa",
  "consultationValidityDays",
  "consultationRenewalPolicy",
  "surgeryQuotaPercent",
  "fixedSalaryFcfa",
  "overtimeHourlyRateFcfa",
  "bonusFcfa",
] as const;

export function employeeFicheAffectsCompensation(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
) {
  if (!before || !after) return true;
  return FINANCIAL_KEYS.some((key) => before[key] !== after[key]);
}

const employeeRecalcSelect = {
  id: true,
  active: true,
  isMedecin: true,
  jobTitle: true,
  doctorCompensationType: true,
  consultationTotalFcfa: true,
  consultationQuotaMode: true,
  consultationQuotaPercent: true,
  consultationQuotaFcfa: true,
  consultationValidityDays: true,
  consultationRenewalPolicy: true,
  surgeryQuotaPercent: true,
  fixedSalaryFcfa: true,
  overtimeHourlyRateFcfa: true,
  bonusFcfa: true,
  user: {
    select: {
      id: true,
      role: true,
      active: true,
    },
  },
} as const;

function doctorProfileFromEmployee(employee: {
  isMedecin: boolean;
  doctorCompensationType: DoctorCompensationType;
  consultationTotalFcfa: number | null;
  consultationQuotaMode: ConsultationQuotaMode;
  consultationQuotaPercent: number | null;
  consultationQuotaFcfa: number | null;
  surgeryQuotaPercent: number | null;
  user: { role: UserRole } | null;
}): DoctorProfile {
  return {
    role: employee.user?.role ?? (employee.isMedecin ? UserRole.MEDECIN : UserRole.RECEPTIONNISTE),
    employee: {
      isMedecin: employee.isMedecin,
      doctorCompensationType: employee.doctorCompensationType,
      consultationTotalFcfa: employee.consultationTotalFcfa,
      consultationQuotaMode: employee.consultationQuotaMode,
      consultationQuotaPercent: employee.consultationQuotaPercent,
      consultationQuotaFcfa: employee.consultationQuotaFcfa,
      surgeryQuotaPercent: employee.surgeryQuotaPercent,
    },
  };
}

const OPEN_CLAIM_STATUSES = [DoctorShareClaimStatus.PENDING_PAYROLL];

/**
 * Recalcule toutes les consultations et opérations déjà enregistrées
 * après un changement de prix de consultation ou de % chirurgie.
 * La paie déjà versée et les heures sup. déjà réglées restent en l'état.
 */
/**
 * Le médecin d'une ligne vient de changer : ses opérations et les parts encore ouvertes
 * reprennent le % actuel de sa fiche.
 */
export async function applyDoctorSharesToVisit(
  tx: Prisma.TransactionClient,
  visitId: string,
  doctorUserId: string,
) {
  const user = await tx.user.findUnique({
    where: { id: doctorUserId },
    select: {
      role: true,
      employee: { select: employeeRecalcSelect },
    },
  });
  const employee = user?.employee;
  if (!user || !employee) return;

  const profile = doctorProfileFromEmployee({
    ...employee,
    user: { role: user.role },
  });
  if (!isMedecin(profile)) return;
  const surgeries = await tx.surgeryCase.findMany({
    where: { visitId, status: { not: SurgeryStatus.CANCELLED } },
    select: {
      id: true,
      totalCostFcfa: true,
      anesthesiologistPercent: true,
      interventionType: { select: { surgeonPercent: true, anesthesiologistPercent: true } },
      invoice: { select: { paidAmountFcfa: true, amountFcfa: true, status: true } },
    },
  });
  for (const surgery of surgeries) {
    const surgeonPercent = resolveSurgeonPercent(surgery.interventionType.surgeonPercent, profile);
    const assistantPercent =
      surgery.anesthesiologistPercent ?? surgery.interventionType.anesthesiologistPercent ?? 0;
    const collected = collectedAmountFcfa(surgery.invoice ?? {});
    const base = collected > 0 ? collected : surgery.totalCostFcfa;
    const shares = computeSurgeryShares(base, surgeonPercent, profile, assistantPercent);
    await tx.surgeryCase.update({
      where: { id: surgery.id },
      data: {
        surgeonId: doctorUserId,
        surgeonPercent,
        surgeonShareFcfa: shares.surgeonShareFcfa,
        clinicShareFcfa: shares.clinicShareFcfa,
      },
    });
    await tx.doctorShareClaim.updateMany({
      where: {
        surgeryCaseId: surgery.id,
        kind: DoctorShareKind.OPERATION_SURGEON,
        status: DoctorShareClaimStatus.PENDING_PAYROLL,
      },
      data: {
        employeeId: employee.id,
        doctorUserId,
        amountFcfa: shares.surgeonShareFcfa,
      },
    });
  }

  const consultationInvoices = await tx.invoice.findMany({
    where: {
      visitId,
      type: InvoiceType.CONSULTATION,
      status: { not: InvoiceStatus.CANCELLED },
    },
    select: { id: true, amountFcfa: true, paidAmountFcfa: true },
  });
  for (const invoice of consultationInvoices) {
    const gross = invoice.paidAmountFcfa > 0 ? invoice.paidAmountFcfa : invoice.amountFcfa;
    const share = computeConsultationShares(
      gross,
      employee.consultationQuotaPercent ?? 0,
      employee.consultationQuotaFcfa,
      employee.consultationQuotaMode,
      profile,
    );
    await tx.doctorShareClaim.updateMany({
      where: {
        invoiceId: invoice.id,
        kind: DoctorShareKind.CONSULTATION,
        status: DoctorShareClaimStatus.PENDING_PAYROLL,
      },
      data: {
        employeeId: employee.id,
        doctorUserId,
        amountFcfa: share.doctorShareFcfa,
      },
    });
  }
}

export async function recalculateAfterEmployeeFicheChange(
  employeeId: string,
): Promise<CompensationRecalcSummary> {
  const summary = emptySummary();
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: employeeRecalcSelect,
  });
  if (!employee) return summary;

  const profile = doctorProfileFromEmployee(employee);
  const doctorUserId = employee.user?.id ?? null;
  const newConsultationFee = resolveDoctorConsultationAmount(profile);

  return prisma.$transaction(
    async (tx) => {
      const summary = emptySummary();
      if (doctorUserId && newConsultationFee > 0) {
        const visits = await tx.visit.findMany({
          where: {
            AND: [
              {
                OR: [
                  { assignedDoctorId: doctorUserId },
                  { consultation: { is: { doctorId: doctorUserId } } },
                ],
              },
              {
                OR: [
                  { consultationFeeFcfa: { gt: 0 } },
                  {
                    invoices: {
                      some: {
                        type: InvoiceType.CONSULTATION,
                        status: { not: InvoiceStatus.CANCELLED },
                        amountFcfa: { gt: 0 },
                      },
                    },
                  },
                ],
              },
            ],
          },
          select: {
            id: true,
            consultationFeeFcfa: true,
            reductionFcfa: true,
            invoices: {
              where: {
                type: InvoiceType.CONSULTATION,
                status: { not: InvoiceStatus.CANCELLED },
              },
              select: { id: true, amountFcfa: true, paidAmountFcfa: true, status: true },
            },
          },
        });

        for (const visit of visits) {
          const amounts = computeConsultationAmounts(newConsultationFee, visit.reductionFcfa);
          const feeChanged = (visit.consultationFeeFcfa ?? 0) !== amounts.consultationFeeFcfa;
          let invoiceChanged = false;

          for (const invoice of visit.invoices) {
            const next = nextConsultationInvoiceState(invoice, amounts.totalFcfa);
            const changed =
              next.amountFcfa !== invoice.amountFcfa ||
              next.paidAmountFcfa !== invoice.paidAmountFcfa ||
              next.status !== invoice.status;
            if (!changed) continue;
            invoiceChanged = true;
            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                amountFcfa: next.amountFcfa,
                paidAmountFcfa: next.paidAmountFcfa,
                status: next.status,
              },
            });
            if (next.alignPayments) {
              await alignInvoicePayments(tx, invoice.id, next.paidAmountFcfa);
            }
          }

          if (!feeChanged && !invoiceChanged) continue;

          if (feeChanged) {
            await tx.visit.update({
              where: { id: visit.id },
              data: { consultationFeeFcfa: amounts.consultationFeeFcfa || null },
            });
          }
          summary.pendingConsultationInvoices += 1;
        }
      }

      if (doctorUserId) {
        const unpaidSurgeries = await tx.surgeryCase.findMany({
          where: {
            surgeonId: doctorUserId,
            status: { not: SurgeryStatus.CANCELLED },
          },
          select: {
            id: true,
            totalCostFcfa: true,
            surgeonPercent: true,
            surgeonShareFcfa: true,
            clinicShareFcfa: true,
            anesthesiologistPercent: true,
            interventionType: { select: { surgeonPercent: true, anesthesiologistPercent: true } },
          },
        });

        const ficheSurgeonPercent = doctorSurgeryQuotaPercent(profile);
        for (const surgery of unpaidSurgeries) {
          const shares = computeSurgeryShares(
            surgery.totalCostFcfa,
            surgery.interventionType.surgeonPercent,
            profile,
            surgery.anesthesiologistPercent ?? surgery.interventionType.anesthesiologistPercent ?? 0,
          );
          const nextSurgeonPercent = ficheSurgeonPercent ?? surgery.surgeonPercent;
          if (
            shares.surgeonShareFcfa === surgery.surgeonShareFcfa &&
            shares.clinicShareFcfa === surgery.clinicShareFcfa &&
            nextSurgeonPercent === surgery.surgeonPercent
          ) {
            continue;
          }
          await tx.surgeryCase.update({
            where: { id: surgery.id },
            data: {
              ...(ficheSurgeonPercent != null ? { surgeonPercent: ficheSurgeonPercent } : {}),
              surgeonShareFcfa: shares.surgeonShareFcfa,
              clinicShareFcfa: shares.clinicShareFcfa,
            },
          });
          summary.unpaidSurgeryShares += 1;
        }

        if (ficheSurgeonPercent != null) {
          const assisted = await tx.surgeryCase.findMany({
            where: {
              anesthesiologistId: doctorUserId,
              status: { not: SurgeryStatus.CANCELLED },
            },
            select: {
              id: true,
              totalCostFcfa: true,
              surgeonShareFcfa: true,
              anesthesiologistPercent: true,
              clinicShareFcfa: true,
              interventionType: { select: { anesthesiologistPercent: true } },
            },
          });
          for (const surgery of assisted) {
            const nextPercent = resolveAssistantPercent(
              surgery.interventionType.anesthesiologistPercent,
              profile,
            );
            if (nextPercent === (surgery.anesthesiologistPercent ?? 0)) continue;
            const assistantShareFcfa = Math.round((surgery.totalCostFcfa * nextPercent) / 100);
            await tx.surgeryCase.update({
              where: { id: surgery.id },
              data: {
                anesthesiologistPercent: nextPercent,
                clinicShareFcfa: Math.max(0, surgery.totalCostFcfa - surgery.surgeonShareFcfa - assistantShareFcfa),
              },
            });
            summary.unpaidSurgeryShares += 1;
          }
        }
      }

      const pendingClaims = await tx.doctorShareClaim.findMany({
        where: {
          employeeId,
          status: { in: OPEN_CLAIM_STATUSES },
        },
        select: {
          id: true,
          kind: true,
          status: true,
          amountFcfa: true,
          invoiceId: true,
          surgeryCaseId: true,
        },
      });

      for (const claim of pendingClaims) {
        let nextAmount = claim.amountFcfa;

        if (claim.kind === DoctorShareKind.CONSULTATION && claim.invoiceId) {
          const invoice = await tx.invoice.findUnique({
            where: { id: claim.invoiceId },
            select: { amountFcfa: true, paidAmountFcfa: true },
          });
          if (invoice) {
            const gross = invoice.paidAmountFcfa > 0 ? invoice.paidAmountFcfa : invoice.amountFcfa;
            nextAmount = computeConsultationShares(
              gross,
              employee.consultationQuotaPercent ?? 0,
              employee.consultationQuotaFcfa,
              employee.consultationQuotaMode,
              profile,
            ).doctorShareFcfa;
          }
        } else if (claim.kind === DoctorShareKind.OPERATION_SURGEON && claim.surgeryCaseId) {
          const surgery = await tx.surgeryCase.findUnique({
            where: { id: claim.surgeryCaseId },
            select: {
              surgeonShareFcfa: true,
              surgeonPercent: true,
              totalCostFcfa: true,
              status: true,
              interventionType: { select: { surgeonPercent: true } },
              invoice: { select: { paidAmountFcfa: true, amountFcfa: true, status: true } },
            },
          });
          if (surgery) {
            const collected = collectedAmountFcfa(surgery.invoice ?? {});
            nextAmount = computeSurgeryShares(
              collected,
              surgery.surgeonPercent ?? surgery.interventionType.surgeonPercent,
              profile,
            ).surgeonShareFcfa;
          }
        } else if (claim.kind === DoctorShareKind.OPERATION_ASSISTANT && claim.surgeryCaseId) {
          const surgery = await tx.surgeryCase.findUnique({
            where: { id: claim.surgeryCaseId },
            select: {
              totalCostFcfa: true,
              status: true,
              anesthesiologistPercent: true,
              interventionType: { select: { anesthesiologistPercent: true } },
              invoice: { select: { paidAmountFcfa: true, amountFcfa: true, status: true } },
            },
          });
          if (surgery) {
            const pct = resolveAssistantPercent(
              surgery.anesthesiologistPercent ?? surgery.interventionType.anesthesiologistPercent,
              profile,
            );
            const collected = collectedAmountFcfa(surgery.invoice ?? {});
            nextAmount = Math.round((collected * pct) / 100);
          }
        }

        if (nextAmount === claim.amountFcfa) continue;

        await tx.doctorShareClaim.update({
          where: { id: claim.id },
          data:
            nextAmount <= 0 && claim.status === DoctorShareClaimStatus.PENDING_PAYROLL
              ? { amountFcfa: 0, status: DoctorShareClaimStatus.CANCELLED }
              : { amountFcfa: Math.max(0, nextAmount) },
        });
        summary.pendingShareClaims += 1;
      }

      const overtimeRate = employee.overtimeHourlyRateFcfa ?? 0;
      const overtimeRows = await tx.doctorOvertimeEntry.findMany({
        where: {
          employeeId,
          status: { in: [DoctorOvertimeStatus.PENDING, DoctorOvertimeStatus.VALIDATED] },
        },
        select: { id: true, minutesWorked: true, hourlyRateFcfa: true, amountFcfa: true },
      });
      for (const row of overtimeRows) {
        const amountFcfa = computeOvertimeAmountFcfa(row.minutesWorked, overtimeRate);
        if (row.hourlyRateFcfa === overtimeRate && row.amountFcfa === amountFcfa) continue;
        await tx.doctorOvertimeEntry.update({
          where: { id: row.id },
          data: { hourlyRateFcfa: overtimeRate, amountFcfa },
        });
        summary.pendingOvertime += 1;
      }

      const grossFcfa = employeeGrossSalary(employee) ?? 0;
      const payrollEligible =
        employee.active && (!employee.user || employee.user.active);
      const payrolls = await tx.employeePayroll.findMany({
        where: {
          employeeId,
          status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
        },
        select: { id: true, year: true, month: true, grossFcfa: true },
      });
      const seenPayrollIds = new Set<string>();
      for (const row of payrolls) {
        if (!payrollEligible) continue;
        if (row.grossFcfa === grossFcfa) continue;
        await tx.employeePayroll.update({
          where: { id: row.id },
          data: { grossFcfa },
        });
        seenPayrollIds.add(row.id);
        summary.pendingPayrolls += 1;
      }

      if (payrollEligible && grossFcfa > 0) {
        const { year, month } = currentPayrollPeriod();
        const existing = await tx.employeePayroll.findUnique({
          where: { employeeId_year_month: { employeeId, year, month } },
          select: { id: true, status: true, grossFcfa: true },
        });
        if (!existing) {
          await tx.employeePayroll.create({
            data: {
              employeeId,
              year,
              month,
              grossFcfa,
              status: PayrollStatus.PENDING,
            },
          });
          summary.pendingPayrolls += 1;
        } else if (
          existing.status !== PayrollStatus.PAID &&
          existing.grossFcfa !== grossFcfa &&
          !seenPayrollIds.has(existing.id)
        ) {
          await tx.employeePayroll.update({
            where: { id: existing.id },
            data: { grossFcfa },
          });
          summary.pendingPayrolls += 1;
        }
      }

      return summary;
    },
    { timeout: 120_000 },
  );
}

async function alignInvoicePayments(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  targetFcfa: number,
) {
  const payments = await tx.invoicePayment.findMany({
    where: { invoiceId },
    orderBy: { paidAt: "asc" },
    select: { id: true, amountFcfa: true },
  });
  const nextAmounts = scaledPaymentAmounts(
    payments.map((payment) => payment.amountFcfa),
    targetFcfa,
  );
  for (let index = 0; index < payments.length; index += 1) {
    if (payments[index].amountFcfa === nextAmounts[index]) continue;
    await tx.invoicePayment.update({
      where: { id: payments[index].id },
      data: { amountFcfa: nextAmounts[index] },
    });
  }
}

const surgeonTariffSelect = {
  role: true,
  employee: {
    select: {
      isMedecin: true,
      doctorCompensationType: true,
      consultationTotalFcfa: true,
      consultationQuotaMode: true,
      consultationQuotaPercent: true,
      consultationQuotaFcfa: true,
      surgeryQuotaPercent: true,
    },
  },
} as const;

/**
 * Après un changement de % sur un type d'opération : toutes les interventions
 * de ce type reprennent le % actuel (le % de la fiche chirurgien prime).
 */
export async function recalculateSurgeriesForIntervention(interventionTypeId: string) {
  const cases = await prisma.surgeryCase.findMany({
    where: {
      interventionTypeId,
      status: { not: SurgeryStatus.CANCELLED },
    },
    select: {
      id: true,
      totalCostFcfa: true,
      surgeonShareFcfa: true,
      clinicShareFcfa: true,
      status: true,
      anesthesiologistPercent: true,
      interventionType: {
        select: { surgeonPercent: true, anesthesiologistPercent: true },
      },
      invoice: { select: { paidAmountFcfa: true } },
      surgeon: { select: surgeonTariffSelect },
    },
  });
  if (cases.length === 0) return 0;

  let updated = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const surgery of cases) {
        const profile: DoctorProfile = {
          role: surgery.surgeon.role,
          employee: surgery.surgeon.employee,
        };
        const shares = computeSurgeryShares(
          surgery.totalCostFcfa,
          surgery.interventionType.surgeonPercent,
          profile,
          surgery.anesthesiologistPercent ?? surgery.interventionType.anesthesiologistPercent ?? 0,
        );
        if (
          shares.surgeonShareFcfa !== surgery.surgeonShareFcfa ||
          shares.clinicShareFcfa !== surgery.clinicShareFcfa
        ) {
          await tx.surgeryCase.update({
            where: { id: surgery.id },
            data: {
              surgeonShareFcfa: shares.surgeonShareFcfa,
              clinicShareFcfa: shares.clinicShareFcfa,
            },
          });
          updated += 1;
        }

        const collected = surgery.invoice?.paidAmountFcfa ?? 0;
        const base =
          surgery.status === SurgeryStatus.COMPLETED
            ? surgery.totalCostFcfa
            : collected > 0
              ? collected
              : surgery.totalCostFcfa;
        const surgeonAmount = computeSurgeryShares(
          base,
          surgery.interventionType.surgeonPercent,
          profile,
        ).surgeonShareFcfa;
        const assistantAmount = Math.round(
          (base *
            resolveAssistantPercent(
              surgery.anesthesiologistPercent ?? surgery.interventionType.anesthesiologistPercent,
              null,
            )) /
            100,
        );

        const claims = await tx.doctorShareClaim.findMany({
          where: {
            surgeryCaseId: surgery.id,
            status: { in: OPEN_CLAIM_STATUSES },
            kind: {
              in: [DoctorShareKind.OPERATION_SURGEON, DoctorShareKind.OPERATION_ASSISTANT],
            },
          },
          select: { id: true, kind: true, status: true, amountFcfa: true },
        });
        for (const claim of claims) {
          const nextAmount =
            claim.kind === DoctorShareKind.OPERATION_ASSISTANT ? assistantAmount : surgeonAmount;
          if (nextAmount === claim.amountFcfa) continue;
          await tx.doctorShareClaim.update({
            where: { id: claim.id },
            data:
              nextAmount <= 0 && claim.status === DoctorShareClaimStatus.PENDING_PAYROLL
                ? { amountFcfa: 0, status: DoctorShareClaimStatus.CANCELLED }
                : { amountFcfa: Math.max(0, nextAmount) },
          });
          updated += 1;
        }
      }
    },
    { timeout: 120_000 },
  );
  return updated;
}

/** Aligne tous les dossiers sur les prix et % actuellement enregistrés sur les fiches. */
export async function syncAllRecordedTariffs() {
  const employees = await prisma.employee.findMany({
    where: {
      user: { isNot: null },
      OR: [
        { consultationTotalFcfa: { gt: 0 } },
        { surgeryQuotaPercent: { gt: 0 } },
        { isMedecin: true },
      ],
    },
    select: { id: true },
  });

  const totals = emptySummary();
  for (const employee of employees) {
    const summary = await recalculateAfterEmployeeFicheChange(employee.id);
    totals.pendingConsultationInvoices += summary.pendingConsultationInvoices;
    totals.unpaidSurgeryShares += summary.unpaidSurgeryShares;
    totals.pendingShareClaims += summary.pendingShareClaims;
  }
  return totals;
}

export async function recalculateAfterEmployeeFicheChangeSafe(employeeId: string) {
  try {
    const summary = await recalculateAfterEmployeeFicheChange(employeeId);
    if (compensationRecalcTouched(summary)) {
      console.info("[compensation-recalc]", employeeId, summary);
    }
    return summary;
  } catch (error) {
    console.error("[compensation-recalc]", employeeId, error);
    return emptySummary();
  }
}
