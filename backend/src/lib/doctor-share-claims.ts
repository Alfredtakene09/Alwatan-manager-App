import {
  DoctorShareClaimStatus,
  DoctorShareKind,
  InvoiceStatus,
  InvoiceType,
  SharePaymentMethod,
  SurgeryStatus,
  UserRole,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "./db.js";
import {
  computeConsultationShares,
  computeSurgeryShares,
  doctorUsesFixedSalary,
  doctorUsesQuota,
  serializeDoctorFields,
  type DoctorProfile,
} from "./doctor-compensation.js";
import { currentPayrollPeriod } from "./admin-payroll.js";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type ReceivablePeriod = {
  from: Date;
  to: Date;
  label: "day" | "month";
};

export function periodBounds(mode: "day" | "month", dateKey?: string): ReceivablePeriod {
  if (mode === "day") {
    const raw = dateKey ?? new Date().toISOString().slice(0, 10);
    const [y, m, d] = raw.split("-").map(Number);
    const from = new Date(y, m - 1, d);
    const to = new Date(y, m - 1, d + 1);
    return { from, to, label: "day" };
  }
  const raw =
    dateKey ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [y, m] = raw.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 1);
  return { from, to, label: "month" };
}

const blockingClaimStatuses: DoctorShareClaimStatus[] = [
  DoctorShareClaimStatus.PENDING_PAYROLL,
  DoctorShareClaimStatus.SETTLED_CASH,
  DoctorShareClaimStatus.SETTLED_PAYROLL,
];

function doctorProfileFromUser(user: {
  role: UserRole;
  employee: DoctorProfile["employee"];
}): DoctorProfile {
  return { role: user.role, employee: user.employee };
}

export async function listDoctorsWithPercentShares() {
  const doctors = await prisma.user.findMany({
    where: {
      active: true,
      OR: [{ role: "MEDECIN" }, { employee: { is: { isMedecin: true } } }],
      employee: { is: { active: true } },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      employee: {
        select: {
          id: true,
          isMedecin: true,
          doctorCompensationType: true,
          consultationTotalFcfa: true,
          consultationQuotaMode: true,
          consultationQuotaPercent: true,
          consultationQuotaFcfa: true,
          surgeryQuotaPercent: true,
          fixedSalaryFcfa: true,
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return doctors
    .filter((doc) => {
      const profile = doctorProfileFromUser(doc);
      return doctorUsesQuota(profile) || doctorUsesFixedSalary(profile);
    })
    .map((doc) => {
      const profile = doctorProfileFromUser(doc);
      const fields = serializeDoctorFields(profile);
      return {
        id: doc.id,
        employeeId: doc.employee!.id,
        firstName: doc.firstName,
        lastName: doc.lastName,
        hasConsultationQuota: doctorUsesQuota(profile),
        canAddToSalary: doctorUsesFixedSalary(profile),
        consultationQuotaPercent: fields.consultationQuotaPercent,
        consultationQuotaMode: fields.consultationQuotaMode,
        doctorCompensationType: fields.doctorCompensationType,
      };
    });
}

async function loadDoctor(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      employeeId: true,
      employee: {
        select: {
          id: true,
          isMedecin: true,
          doctorCompensationType: true,
          consultationTotalFcfa: true,
          consultationQuotaMode: true,
          consultationQuotaPercent: true,
          consultationQuotaFcfa: true,
          surgeryQuotaPercent: true,
          fixedSalaryFcfa: true,
        },
      },
    },
  });
}

export async function buildDoctorReceivable(
  doctorUserId: string,
  period: ReceivablePeriod,
) {
  const doctor = await loadDoctor(doctorUserId);
  if (!doctor?.employee) {
    return {
      doctorId: doctorUserId,
      firstName: "",
      lastName: "",
      canAddToSalary: false,
      hasConsultationQuota: false,
      consultationShareFcfa: 0,
      surgeryShareFcfa: 0,
      totalShareFcfa: 0,
      pendingPayrollFcfa: 0,
      items: [] as Array<{
        key: string;
        kind: DoctorShareKind;
        amountFcfa: number;
        businessDate: string;
        surgeryCaseId?: string;
        invoiceId?: string;
        label: string;
      }>,
    };
  }

  const profile = doctorProfileFromUser(doctor);
  const fields = serializeDoctorFields(profile);
  const hasConsultationQuota = doctorUsesQuota(profile);
  const canAddToSalary = doctorUsesFixedSalary(profile);

  const existingClaims = await prisma.doctorShareClaim.findMany({
    where: {
      doctorUserId,
      status: { in: blockingClaimStatuses },
      OR: [
        { businessDate: { gte: period.from, lt: period.to } },
        {
          status: DoctorShareClaimStatus.PENDING_PAYROLL,
        },
      ],
    },
    select: {
      kind: true,
      surgeryCaseId: true,
      invoiceId: true,
      amountFcfa: true,
      status: true,
    },
  });

  const claimedSurgery = new Set(
    existingClaims
      .filter((c) => c.surgeryCaseId)
      .map((c) => `${c.surgeryCaseId}:${c.kind}`),
  );
  const claimedInvoices = new Set(
    existingClaims.filter((c) => c.invoiceId).map((c) => c.invoiceId as string),
  );
  const pendingPayrollFcfa = existingClaims
    .filter((c) => c.status === DoctorShareClaimStatus.PENDING_PAYROLL)
    .reduce((sum, c) => sum + c.amountFcfa, 0);

  const items: Array<{
    key: string;
    kind: DoctorShareKind;
    amountFcfa: number;
    businessDate: string;
    surgeryCaseId?: string;
    invoiceId?: string;
    label: string;
  }> = [];

  // Opérations effectuées non réglées (cash) et hors demande paie
  const surgeries = await prisma.surgeryCase.findMany({
    where: {
      status: SurgeryStatus.COMPLETED,
      completedAt: { gte: period.from, lt: period.to },
      OR: [
        { surgeonId: doctorUserId, surgeonPaidAt: null },
        {
          interventionType: { anesthesiologistId: doctorUserId },
          assistantPaidAt: null,
        },
      ],
    },
    select: {
      id: true,
      completedAt: true,
      surgeonId: true,
      surgeonShareFcfa: true,
      totalCostFcfa: true,
      interventionType: {
        select: {
          label: true,
          anesthesiologistId: true,
          anesthesiologistPercent: true,
        },
      },
    },
  });

  for (const surgery of surgeries) {
    const businessDate = (surgery.completedAt ?? period.from).toISOString().slice(0, 10);
    if (
      surgery.surgeonId === doctorUserId &&
      !claimedSurgery.has(`${surgery.id}:${DoctorShareKind.OPERATION_SURGEON}`)
    ) {
      const amount = surgery.surgeonShareFcfa;
      if (amount > 0) {
        items.push({
          key: `op-surgeon-${surgery.id}`,
          kind: DoctorShareKind.OPERATION_SURGEON,
          amountFcfa: amount,
          businessDate,
          surgeryCaseId: surgery.id,
          label: surgery.interventionType.label,
        });
      }
    }
    if (
      surgery.interventionType.anesthesiologistId === doctorUserId &&
      (surgery.interventionType.anesthesiologistPercent ?? 0) > 0 &&
      !claimedSurgery.has(`${surgery.id}:${DoctorShareKind.OPERATION_ASSISTANT}`)
    ) {
      const amount = Math.round(
        (surgery.totalCostFcfa * (surgery.interventionType.anesthesiologistPercent ?? 0)) / 100,
      );
      if (amount > 0) {
        items.push({
          key: `op-assistant-${surgery.id}`,
          kind: DoctorShareKind.OPERATION_ASSISTANT,
          amountFcfa: amount,
          businessDate,
          surgeryCaseId: surgery.id,
          label: `${surgery.interventionType.label} (assistant)`,
        });
      }
    }
  }

  // Opérations pas encore « effectuées » mais avec encaissement (tranche ou solde).
  // Hors filtre période : reste dues tant que non effectuées / non réglées.
  // Inclut salaire fixe : % typé sur l’intervention (comme surgeonShareFcfa stocké).
  {
    const progressiveInvoices = await prisma.invoice.findMany({
      where: {
        type: InvoiceType.LAB_EXAM,
        billingExamKind: "operation",
        status: { in: [InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID] },
        paidAmountFcfa: { gt: 0 },
        surgeryCase: {
          status: { notIn: [SurgeryStatus.COMPLETED, SurgeryStatus.CANCELLED] },
          OR: [
            { surgeonId: doctorUserId, surgeonPaidAt: null },
            {
              interventionType: { anesthesiologistId: doctorUserId },
              assistantPaidAt: null,
            },
          ],
        },
      },
      select: {
        id: true,
        paidAmountFcfa: true,
        paidAt: true,
        payments: {
          select: { paidAt: true },
          orderBy: { paidAt: "desc" },
          take: 1,
        },
        surgeryCase: {
          select: {
            id: true,
            surgeonId: true,
            interventionType: {
              select: {
                label: true,
                surgeonPercent: true,
                anesthesiologistId: true,
                anesthesiologistPercent: true,
              },
            },
            surgeon: {
              select: {
                role: true,
                employee: {
                  select: {
                    isMedecin: true,
                    doctorCompensationType: true,
                    surgeryQuotaPercent: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const invoice of progressiveInvoices) {
      const surgery = invoice.surgeryCase;
      if (!surgery) continue;
      const collected = invoice.paidAmountFcfa;
      if (collected <= 0) continue;
      const businessDate = (
        invoice.payments[0]?.paidAt ??
        invoice.paidAt ??
        period.from
      )
        .toISOString()
        .slice(0, 10);

      if (
        surgery.surgeonId === doctorUserId &&
        !claimedSurgery.has(`${surgery.id}:${DoctorShareKind.OPERATION_SURGEON}`)
      ) {
        const surgeonProfile = doctorProfileFromUser(surgery.surgeon);
        let amount = 0;
        if (doctorUsesQuota(surgeonProfile)) {
          amount = computeSurgeryShares(
            collected,
            surgery.interventionType.surgeonPercent,
            surgeonProfile,
          ).surgeonShareFcfa;
        } else if ((surgery.interventionType.surgeonPercent ?? 0) > 0) {
          amount = Math.round(
            (collected * surgery.interventionType.surgeonPercent) / 100,
          );
        }
        if (amount > 0) {
          items.push({
            key: `op-surgeon-partial-${surgery.id}`,
            kind: DoctorShareKind.OPERATION_SURGEON,
            amountFcfa: amount,
            businessDate,
            surgeryCaseId: surgery.id,
            label: `${surgery.interventionType.label} (encaisse)`,
          });
          claimedSurgery.add(`${surgery.id}:${DoctorShareKind.OPERATION_SURGEON}`);
        }
      }

      const anesthPct = surgery.interventionType.anesthesiologistPercent ?? 0;
      if (
        surgery.interventionType.anesthesiologistId === doctorUserId &&
        anesthPct > 0 &&
        !claimedSurgery.has(`${surgery.id}:${DoctorShareKind.OPERATION_ASSISTANT}`)
      ) {
        const amount = Math.round((collected * anesthPct) / 100);
        if (amount > 0) {
          items.push({
            key: `op-assistant-partial-${surgery.id}`,
            kind: DoctorShareKind.OPERATION_ASSISTANT,
            amountFcfa: amount,
            businessDate,
            surgeryCaseId: surgery.id,
            label: `${surgery.interventionType.label} (assistant, encaisse)`,
          });
          claimedSurgery.add(`${surgery.id}:${DoctorShareKind.OPERATION_ASSISTANT}`);
        }
      }
    }
  }

  // Consultations encaissées non réglées au médecin
  if (hasConsultationQuota) {
    const invoices = await prisma.invoice.findMany({
      where: {
        type: InvoiceType.CONSULTATION,
        status: { in: [InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID] },
        paidAt: { gte: period.from, lt: period.to },
        visit: {
          OR: [
            { assignedDoctorId: doctorUserId },
            { consultation: { is: { doctorId: doctorUserId } } },
          ],
        },
      },
      select: {
        id: true,
        amountFcfa: true,
        paidAmountFcfa: true,
        paidAt: true,
        invoiceNumber: true,
      },
    });

    for (const invoice of invoices) {
      if (claimedInvoices.has(invoice.id)) continue;
      const gross = invoice.paidAmountFcfa > 0 ? invoice.paidAmountFcfa : invoice.amountFcfa;
      const { doctorShareFcfa } = computeConsultationShares(
        gross,
        fields.consultationQuotaPercent ?? 0,
        fields.consultationQuotaFcfa,
        fields.consultationQuotaMode,
        profile,
      );
      if (doctorShareFcfa <= 0) continue;
      items.push({
        key: `consult-${invoice.id}`,
        kind: DoctorShareKind.CONSULTATION,
        amountFcfa: doctorShareFcfa,
        businessDate: (invoice.paidAt ?? period.from).toISOString().slice(0, 10),
        invoiceId: invoice.id,
        label: `Consultation ${invoice.invoiceNumber}`,
      });
    }
  }

  const consultationShareFcfa = items
    .filter((i) => i.kind === DoctorShareKind.CONSULTATION)
    .reduce((s, i) => s + i.amountFcfa, 0);
  const surgeryShareFcfa = items
    .filter((i) => i.kind !== DoctorShareKind.CONSULTATION)
    .reduce((s, i) => s + i.amountFcfa, 0);

  return {
    doctorId: doctor.id,
    firstName: doctor.firstName,
    lastName: doctor.lastName,
    canAddToSalary,
    hasConsultationQuota,
    consultationShareFcfa,
    surgeryShareFcfa,
    totalShareFcfa: consultationShareFcfa + surgeryShareFcfa,
    pendingPayrollFcfa,
    items,
  };
}

export async function buildReceivablesOverview(
  period: ReceivablePeriod,
  doctorUserId?: string | null,
) {
  const doctors = await listDoctorsWithPercentShares();
  const scoped = doctorUserId
    ? doctors.filter((d) => d.id === doctorUserId)
    : doctors;

  const rows = await Promise.all(
    scoped.map(async (doc) => {
      const receivable = await buildDoctorReceivable(doc.id, period);
      return {
        ...doc,
        consultationShareFcfa: receivable.consultationShareFcfa,
        surgeryShareFcfa: receivable.surgeryShareFcfa,
        totalShareFcfa: receivable.totalShareFcfa,
        pendingPayrollFcfa: receivable.pendingPayrollFcfa,
        items: receivable.items,
      };
    }),
  );

  const withBalance = rows.filter(
    (row) =>
      row.totalShareFcfa > 0 ||
      row.pendingPayrollFcfa > 0 ||
      row.hasConsultationQuota ||
      row.canAddToSalary,
  );

  const totals = withBalance.reduce(
    (acc, row) => {
      acc.consultationShareFcfa += row.consultationShareFcfa;
      acc.surgeryShareFcfa += row.surgeryShareFcfa;
      acc.totalShareFcfa += row.totalShareFcfa;
      acc.pendingPayrollFcfa += row.pendingPayrollFcfa;
      return acc;
    },
    {
      consultationShareFcfa: 0,
      surgeryShareFcfa: 0,
      totalShareFcfa: 0,
      pendingPayrollFcfa: 0,
    },
  );

  return {
    period: period.label,
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    totals,
    doctors: withBalance,
    selectedDoctorId: doctorUserId ?? null,
  };
}

export async function requestPayrollForItems(
  tx: DbClient,
  input: {
    doctorUserId: string;
    requestedById: string;
    items: Array<{
      kind: DoctorShareKind;
      amountFcfa: number;
      businessDate: string;
      surgeryCaseId?: string;
      invoiceId?: string;
      comment?: string;
    }>;
  },
) {
  const doctor = await tx.user.findUnique({
    where: { id: input.doctorUserId },
    select: {
      id: true,
      employeeId: true,
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
          fixedSalaryFcfa: true,
        },
      },
    },
  });
  if (!doctor?.employee) throw new Error("DOCTOR_NOT_FOUND");
  if (!doctorUsesFixedSalary(doctorProfileFromUser(doctor))) {
    throw new Error("NOT_SALARIED");
  }

  const { year, month } = currentPayrollPeriod();
  const created = [];

  for (const item of input.items) {
    if (item.amountFcfa <= 0) continue;
    if (item.kind === DoctorShareKind.CONSULTATION && !item.invoiceId) {
      throw new Error("INVOICE_REQUIRED");
    }
    if (
      (item.kind === DoctorShareKind.OPERATION_SURGEON ||
        item.kind === DoctorShareKind.OPERATION_ASSISTANT) &&
      !item.surgeryCaseId
    ) {
      throw new Error("SURGERY_REQUIRED");
    }

    const [y, m, d] = item.businessDate.split("-").map(Number);
    const businessDate = new Date(y, m - 1, d);

    const row = await tx.doctorShareClaim.create({
      data: {
        employeeId: doctor.employeeId,
        doctorUserId: doctor.id,
        kind: item.kind,
        amountFcfa: Math.round(item.amountFcfa),
        businessDate,
        surgeryCaseId: item.surgeryCaseId ?? null,
        invoiceId: item.invoiceId ?? null,
        status: DoctorShareClaimStatus.PENDING_PAYROLL,
        payrollYear: year,
        payrollMonth: month,
        comment: item.comment ?? null,
        requestedById: input.requestedById,
      },
    });
    created.push(row);
  }

  return created;
}

export async function settleConsultationCash(
  tx: DbClient,
  input: {
    settledById: string;
    items: Array<{
      invoiceId: string;
      amountFcfa: number;
      businessDate: string;
      doctorUserId: string;
    }>;
  },
) {
  const now = new Date();
  const created = [];
  for (const item of input.items) {
    const doctor = await tx.user.findUnique({
      where: { id: item.doctorUserId },
      select: { id: true, employeeId: true },
    });
    if (!doctor) continue;
    const [y, m, d] = item.businessDate.split("-").map(Number);
    const row = await tx.doctorShareClaim.create({
      data: {
        employeeId: doctor.employeeId,
        doctorUserId: doctor.id,
        kind: DoctorShareKind.CONSULTATION,
        amountFcfa: Math.round(item.amountFcfa),
        businessDate: new Date(y, m - 1, d),
        invoiceId: item.invoiceId,
        status: DoctorShareClaimStatus.SETTLED_CASH,
        requestedById: input.settledById,
        settledById: input.settledById,
        settledAt: now,
      },
    });
    created.push(row);
  }
  return created;
}

/**
 * Inclut les parts PENDING_PAYROLL du mois dans la paie (prime) et marque SETTLED_PAYROLL + PaidAt ops.
 */
export async function applyPendingShareClaimsToPayroll(
  tx: DbClient,
  input: {
    employeeId: string;
    year: number;
    month: number;
    paidById: string;
    paidAt?: Date;
  },
): Promise<number> {
  const paidAt = input.paidAt ?? new Date();
  const claims = await tx.doctorShareClaim.findMany({
    where: {
      employeeId: input.employeeId,
      status: DoctorShareClaimStatus.PENDING_PAYROLL,
      OR: [
        { payrollYear: input.year, payrollMonth: input.month },
        {
          payrollYear: null,
          businessDate: {
            gte: new Date(input.year, input.month - 1, 1),
            lt: new Date(input.year, input.month, 1),
          },
        },
      ],
    },
  });
  if (!claims.length) return 0;

  const total = claims.reduce((sum: number, c: { amountFcfa: number }) => sum + c.amountFcfa, 0);

  await tx.doctorShareClaim.updateMany({
    where: { id: { in: claims.map((c: { id: string }) => c.id) } },
    data: {
      status: DoctorShareClaimStatus.SETTLED_PAYROLL,
      settledAt: paidAt,
      settledById: input.paidById,
      payrollYear: input.year,
      payrollMonth: input.month,
    },
  });

  for (const claim of claims) {
    if (!claim.surgeryCaseId) continue;
    if (claim.kind === DoctorShareKind.OPERATION_SURGEON) {
      await tx.surgeryCase.update({
        where: { id: claim.surgeryCaseId },
        data: {
          surgeonPaidAt: paidAt,
          surgeonPaidById: input.paidById,
          surgeonPaidMethod: SharePaymentMethod.PAYROLL,
        },
      });
    }
    if (claim.kind === DoctorShareKind.OPERATION_ASSISTANT) {
      await tx.surgeryCase.update({
        where: { id: claim.surgeryCaseId },
        data: {
          assistantPaidAt: paidAt,
          assistantPaidById: input.paidById,
          assistantPaidMethod: SharePaymentMethod.PAYROLL,
        },
      });
    }
  }

  return total;
}
