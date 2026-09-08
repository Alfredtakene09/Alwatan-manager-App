import {
  ConsultationQuotaMode,
  DoctorCompensationType,
  DoctorOvertimeStatus,
  DoctorShareClaimStatus,
  DoctorShareKind,
  InvoiceStatus,
  InvoiceType,
  PayrollStatus,
  SurgeryStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "./db.js";
import { currentPayrollPeriod, employeeGrossSalary } from "./admin-payroll.js";
import { computeConsultationAmounts } from "./consultation-amounts.js";
import {
  computeConsultationShares,
  computeSurgeryShares,
  resolveDoctorConsultationAmount,
  type DoctorProfile,
} from "./doctor-compensation.js";
import { computeOvertimeAmountFcfa } from "./doctor-overtime.js";

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

/**
 * Recalcule les montants encore ouverts après modification de la fiche employé.
 * Ne touche pas aux encaissements, parts déjà réglées, ni paie déjà versée
 * (la recette générale déjà collectée reste inchangée).
 */
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
      if (doctorUserId) {
        const openVisits = await tx.visit.findMany({
          where: {
            OR: [
              { assignedDoctorId: doctorUserId },
              { consultation: { is: { doctorId: doctorUserId } } },
            ],
            invoices: {
              none: {
                type: InvoiceType.CONSULTATION,
                status: { in: [InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID] },
              },
            },
          },
          select: {
            id: true,
            consultationFeeFcfa: true,
            reductionFcfa: true,
            invoices: {
              where: {
                type: InvoiceType.CONSULTATION,
                status: { in: [InvoiceStatus.PENDING, InvoiceStatus.DRAFT] },
                paidAmountFcfa: 0,
              },
              select: { id: true, amountFcfa: true },
            },
          },
        });

        for (const visit of openVisits) {
          const amounts = computeConsultationAmounts(newConsultationFee, visit.reductionFcfa);
          const feeChanged = (visit.consultationFeeFcfa ?? 0) !== amounts.consultationFeeFcfa;
          const pendingInvoice = visit.invoices[0];
          const invoiceChanged = pendingInvoice
            ? pendingInvoice.amountFcfa !== amounts.totalFcfa
            : false;
          if (!feeChanged && !invoiceChanged) continue;

          await tx.visit.update({
            where: { id: visit.id },
            data: { consultationFeeFcfa: amounts.consultationFeeFcfa || null },
          });
          if (pendingInvoice && invoiceChanged) {
            await tx.invoice.update({
              where: { id: pendingInvoice.id },
              data: { amountFcfa: amounts.totalFcfa },
            });
          }
          summary.pendingConsultationInvoices += 1;
        }

        const unpaidSurgeries = await tx.surgeryCase.findMany({
          where: {
            surgeonId: doctorUserId,
            status: { not: SurgeryStatus.CANCELLED },
            surgeonPaidAt: null,
            clinicPaidAt: null,
          },
          select: {
            id: true,
            totalCostFcfa: true,
            surgeonShareFcfa: true,
            clinicShareFcfa: true,
            interventionType: { select: { surgeonPercent: true } },
          },
        });

        for (const surgery of unpaidSurgeries) {
          const shares = computeSurgeryShares(
            surgery.totalCostFcfa,
            surgery.interventionType.surgeonPercent,
            profile,
          );
          if (
            shares.surgeonShareFcfa === surgery.surgeonShareFcfa &&
            shares.clinicShareFcfa === surgery.clinicShareFcfa
          ) {
            continue;
          }
          await tx.surgeryCase.update({
            where: { id: surgery.id },
            data: {
              surgeonShareFcfa: shares.surgeonShareFcfa,
              clinicShareFcfa: shares.clinicShareFcfa,
            },
          });
          summary.unpaidSurgeryShares += 1;
        }
      }

      const pendingClaims = await tx.doctorShareClaim.findMany({
        where: {
          employeeId,
          status: DoctorShareClaimStatus.PENDING_PAYROLL,
        },
        select: {
          id: true,
          kind: true,
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
              totalCostFcfa: true,
              status: true,
              interventionType: { select: { surgeonPercent: true } },
              invoice: { select: { paidAmountFcfa: true } },
            },
          });
          if (surgery) {
            if (surgery.status === SurgeryStatus.COMPLETED) {
              nextAmount = surgery.surgeonShareFcfa;
            } else {
              const collected = surgery.invoice?.paidAmountFcfa ?? 0;
              nextAmount =
                collected > 0
                  ? computeSurgeryShares(
                      collected,
                      surgery.interventionType.surgeonPercent,
                      profile,
                    ).surgeonShareFcfa
                  : computeSurgeryShares(
                      surgery.totalCostFcfa,
                      surgery.interventionType.surgeonPercent,
                      profile,
                    ).surgeonShareFcfa;
            }
          }
        } else if (claim.kind === DoctorShareKind.OPERATION_ASSISTANT && claim.surgeryCaseId) {
          const surgery = await tx.surgeryCase.findUnique({
            where: { id: claim.surgeryCaseId },
            select: {
              totalCostFcfa: true,
              status: true,
              interventionType: { select: { anesthesiologistPercent: true } },
              invoice: { select: { paidAmountFcfa: true } },
            },
          });
          if (surgery) {
            const pct = surgery.interventionType.anesthesiologistPercent ?? 0;
            const base =
              surgery.status === SurgeryStatus.COMPLETED
                ? surgery.totalCostFcfa
                : (surgery.invoice?.paidAmountFcfa ?? surgery.totalCostFcfa);
            nextAmount = Math.round((base * pct) / 100);
          }
        }

        if (nextAmount === claim.amountFcfa) continue;

        await tx.doctorShareClaim.update({
          where: { id: claim.id },
          data:
            nextAmount <= 0
              ? { amountFcfa: 0, status: DoctorShareClaimStatus.CANCELLED }
              : { amountFcfa: nextAmount },
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
      const payrolls = await tx.employeePayroll.findMany({
        where: {
          employeeId,
          status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
        },
        select: { id: true, year: true, month: true, grossFcfa: true },
      });
      const seenPayrollIds = new Set<string>();
      for (const row of payrolls) {
        if (row.grossFcfa === grossFcfa) continue;
        await tx.employeePayroll.update({
          where: { id: row.id },
          data: { grossFcfa },
        });
        seenPayrollIds.add(row.id);
        summary.pendingPayrolls += 1;
      }

      if (grossFcfa > 0) {
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
    { timeout: 30_000 },
  );
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
