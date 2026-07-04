import {
  InvoiceStatus,
  InvoiceType,
  ReceptionShiftSlot,
  UserRole,
} from "@prisma/client";
import { prisma } from "./db.js";
import {
  formatBusinessDate,
  formatShiftWindowLabel,
  businessDateForCollectedAt,
  inferShiftSlotFromDate,
  parseBusinessDate,
  SHIFT_SLOT_LABELS,
} from "./cash-shift.js";
import { netAfterExpenses, sumExpensesForCashierShift } from "./cashier-personal-stats.js";
import { comptabiliteInvoicePatientWhere } from "./patient-billing.js";
import {
  assessComptableDisbursementSchedule,
  COMPTABLE_DISBURSEMENT_WORKFLOW_HINT,
} from "./gestionnaire-comptable-disbursement.js";
import {
  COLLECTED_INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
  invoiceCollectedAt,
  startOfDay,
} from "./revenue-stats.js";

export { COMPTABLE_DISBURSEMENT_WORKFLOW_HINT };

export type CashRegisterId = "reception" | "comptabilite";

/** Seule caisse gérée par le gestionnaire (tirelire comptable après décaissement réception). */
export const GESTIONNAIRE_REGISTER_ID: CashRegisterId = "comptabilite";

export const GESTIONNAIRE_MANAGED_REGISTERS: CashRegisterId[] = [GESTIONNAIRE_REGISTER_ID];

const REGISTER_LABELS: Record<CashRegisterId, string> = {
  reception: "Caisse Réception",
  comptabilite: "Caisse Comptable",
};

export function isReceptionRegister(role: UserRole) {
  return role === UserRole.RECEPTIONNISTE;
}

export function registerForRole(role: UserRole): CashRegisterId {
  return isReceptionRegister(role) ? "reception" : "comptabilite";
}

function registerRoleFilter(registerId: CashRegisterId) {
  return registerId === "reception"
    ? (role: UserRole) => role === UserRole.RECEPTIONNISTE
    : (role: UserRole) => role !== UserRole.RECEPTIONNISTE;
}

type UnsettledInvoice = Awaited<ReturnType<typeof fetchAllUnsettledInvoices>>[number];

async function fetchAllUnsettledInvoices() {
  return prisma.invoice.findMany({
    where: {
      type: { in: COLLECTED_INVOICE_TYPES },
      status: { not: InvoiceStatus.CANCELLED },
      cashSettlementLine: null,
      issuedBy: {
        role: { in: [UserRole.RECEPTIONNISTE, UserRole.COMPTABLE] },
      },
      ...comptabiliteInvoicePatientWhere(),
      OR: [
        { status: InvoiceStatus.PAID },
        {
          type: InvoiceType.CONSULTATION,
          status: InvoiceStatus.PENDING,
        },
      ],
    },
    include: {
      patient: { select: { code: true, firstName: true, lastName: true } },
      issuedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
    },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
  });
}

type SettlementBatchKey = string;

function batchKey(cashierId: string, businessDate: Date, shiftSlot: ReceptionShiftSlot) {
  return `${cashierId}|${formatBusinessDate(businessDate)}|${shiftSlot}`;
}

function groupInvoicesForSettlement(invoices: UnsettledInvoice[]) {
  const groups = new Map<
    SettlementBatchKey,
    {
      cashierId: string;
      cashierName: string;
      cashierRole: UserRole;
      businessDate: Date;
      shiftSlot: ReceptionShiftSlot;
      invoices: UnsettledInvoice[];
    }
  >();

  for (const invoice of invoices) {
    const collectedAt = invoiceCollectedAt(invoice);
    if (!collectedAt) continue;
    const shiftSlot = inferShiftSlotFromDate(collectedAt);
    if (!shiftSlot) continue;
    const businessDate = businessDateForCollectedAt(collectedAt);
    const key = batchKey(invoice.issuedById, businessDate, shiftSlot);
    const existing = groups.get(key);
    if (existing) {
      existing.invoices.push(invoice);
      continue;
    }
    groups.set(key, {
      cashierId: invoice.issuedById,
      cashierName: `${invoice.issuedBy.firstName} ${invoice.issuedBy.lastName}`.trim(),
      cashierRole: invoice.issuedBy.role,
      businessDate,
      shiftSlot,
      invoices: [invoice],
    });
  }

  return [...groups.values()];
}

async function enrichBatchNet(
  batch: ReturnType<typeof groupInvoicesForSettlement>[number],
) {
  const systemTotalFcfa = batch.invoices.reduce((sum, row) => sum + row.amountFcfa, 0);
  const expenseSummary = await sumExpensesForCashierShift(
    batch.cashierId,
    batch.businessDate,
    batch.shiftSlot,
  );
  const netTotalFcfa = netAfterExpenses(systemTotalFcfa, expenseSummary.totalFcfa);
  return {
    ...batch,
    systemTotalFcfa,
    expensesTotalFcfa: expenseSummary.totalFcfa,
    netTotalFcfa,
    transactionCount: batch.invoices.length,
    expenses: expenseSummary.rows,
  };
}

export async function getCashRegistersOverview() {
  const unsettled = await fetchAllUnsettledInvoices();
  const batches = groupInvoicesForSettlement(unsettled);
  const enriched = await Promise.all(batches.map(enrichBatchNet));

  const lastSettlements = await prisma.receptionCashSettlement.findMany({
    where: {
      receptionist: { role: { not: UserRole.RECEPTIONNISTE } },
    },
    orderBy: { settledAt: "desc" },
    take: 200,
    include: {
      receptionist: { select: { role: true } },
    },
  });

  const lastByRegister: Record<CashRegisterId, Date | null> = {
    reception: null,
    comptabilite: null,
  };
  for (const row of lastSettlements) {
    const reg = registerForRole(row.receptionist.role);
    if (!lastByRegister[reg]) lastByRegister[reg] = row.settledAt;
  }

  const now = Date.now();
  return GESTIONNAIRE_MANAGED_REGISTERS.map((id) => {
    const filter = registerRoleFilter(id);
    const registerBatches = enriched.filter((batch) => filter(batch.cashierRole));
    const balanceFcfa = registerBatches.reduce((sum, row) => sum + row.netTotalFcfa, 0);
    const transactionCount = registerBatches.reduce((sum, row) => sum + row.transactionCount, 0);
    const oldestPendingBusinessDate =
      registerBatches.length > 0
        ? registerBatches.reduce(
            (min, row) => (row.businessDate < min ? row.businessDate : min),
            registerBatches[0]!.businessDate,
          )
        : null;
    const lastDisbursementAt = lastByRegister[id];
    const hoursSince = lastDisbursementAt
      ? (now - lastDisbursementAt.getTime()) / 3600000
      : null;
    const schedule = assessComptableDisbursementSchedule({
      pendingFcfa: balanceFcfa,
      lastDisbursementAt,
      oldestPendingBusinessDate,
    });
    return {
      id,
      label: REGISTER_LABELS[id],
      balanceFcfa,
      transactionCount,
      lastDisbursementAt: lastDisbursementAt?.toISOString() ?? null,
      hoursSinceLastDisbursement: hoursSince != null ? Math.round(hoursSince) : null,
      overdue: schedule.overdue,
      disbursementPhase: schedule.phase,
      disbursementStatusLabel: schedule.statusLabel,
      disbursementHint: schedule.scheduleHint,
    };
  });
}

export async function getCashRegisterDetail(registerId: CashRegisterId) {
  if (!GESTIONNAIRE_MANAGED_REGISTERS.includes(registerId)) {
    throw new Error("REGISTER_FORBIDDEN");
  }
  const filter = registerRoleFilter(registerId);
  const unsettled = (await fetchAllUnsettledInvoices()).filter((row) =>
    filter(row.issuedBy.role),
  );
  const batches = await Promise.all(
    groupInvoicesForSettlement(unsettled).map(enrichBatchNet),
  );

  const transactions = unsettled.map((invoice) => {
    const collectedAt = invoiceCollectedAt(invoice)!;
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      type: invoice.type,
      typeLabel: INVOICE_TYPE_LABELS[invoice.type],
      amountFcfa: invoice.amountFcfa,
      collectedAt: collectedAt.toISOString(),
      cashierName: `${invoice.issuedBy.firstName} ${invoice.issuedBy.lastName}`.trim(),
      patientLabel: invoice.patient
        ? `${invoice.patient.code} — ${invoice.patient.firstName} ${invoice.patient.lastName}`.trim()
        : "Client externe",
    };
  });

  const balanceFcfa = batches.reduce((sum, row) => sum + row.netTotalFcfa, 0);
  const grossFcfa = batches.reduce((sum, row) => sum + row.systemTotalFcfa, 0);
  const expensesFcfa = batches.reduce((sum, row) => sum + row.expensesTotalFcfa, 0);

  return {
    id: registerId,
    label: REGISTER_LABELS[registerId],
    balanceFcfa,
    grossFcfa,
    expensesFcfa,
    transactionCount: transactions.length,
    transactions,
    batches: batches.map((batch) => ({
      cashierId: batch.cashierId,
      cashierName: batch.cashierName,
      businessDate: formatBusinessDate(batch.businessDate),
      shiftSlot: batch.shiftSlot,
      shiftLabel: SHIFT_SLOT_LABELS[batch.shiftSlot],
      windowLabel: formatShiftWindowLabel(batch.businessDate, batch.shiftSlot),
      netTotalFcfa: batch.netTotalFcfa,
      transactionCount: batch.transactionCount,
    })),
  };
}

export async function disburseCashRegister(params: {
  registerId: CashRegisterId;
  gestionnaireId: string;
  disbursementFcfa: number;
  comment?: string;
}) {
  if (!GESTIONNAIRE_MANAGED_REGISTERS.includes(params.registerId)) {
    throw new Error("REGISTER_FORBIDDEN");
  }
  const detail = await getCashRegisterDetail(params.registerId);
  if (detail.balanceFcfa <= 0) {
    throw new Error("NO_PENDING");
  }
  if (params.disbursementFcfa <= 0 || params.disbursementFcfa > detail.balanceFcfa) {
    throw new Error("INVALID_AMOUNT");
  }

  const filter = registerRoleFilter(params.registerId);
  const unsettled = (await fetchAllUnsettledInvoices()).filter((row) =>
    filter(row.issuedBy.role),
  );
  const batches = await Promise.all(
    groupInvoicesForSettlement(unsettled).map(enrichBatchNet),
  );

  const results: string[] = [];
  let remaining = params.disbursementFcfa;

  for (const batch of batches.sort((a, b) => {
    const ta = a.businessDate.getTime();
    const tb = b.businessDate.getTime();
    return ta - tb;
  })) {
    if (remaining <= 0) break;
    if (batch.netTotalFcfa <= 0) continue;

    const existing = await prisma.receptionCashSettlement.findUnique({
      where: {
        receptionistId_businessDate_shiftSlot: {
          receptionistId: batch.cashierId,
          businessDate: batch.businessDate,
          shiftSlot: batch.shiftSlot,
        },
      },
    });

    const mergedComment = [
      params.comment?.trim(),
      `Décaissement gestionnaire — ${REGISTER_LABELS[params.registerId]}`,
    ]
      .filter(Boolean)
      .join(" · ");

    if (existing) {
      const supplementGrossFcfa = batch.systemTotalFcfa;
      if (supplementGrossFcfa <= 0) continue;

      const expensesAlreadyApplied = Math.max(
        0,
        existing.systemTotalFcfa - existing.disbursementFcfa,
      );
      const incrementalExpenses = Math.max(
        0,
        batch.expensesTotalFcfa - expensesAlreadyApplied,
      );
      const supplementNetFcfa = netAfterExpenses(supplementGrossFcfa, incrementalExpenses);
      const disburseAmount = Math.min(remaining, supplementNetFcfa);
      if (disburseAmount <= 0) continue;

      const supplementNote = `Collecte gestionnaire +${disburseAmount.toLocaleString("fr-FR")} FCFA (${batch.invoices.length} facture(s))`;
      const updatedComment = [existing.comment, supplementNote, mergedComment]
        .filter(Boolean)
        .join(" · ");

      await prisma.$transaction(async (tx) => {
        const freshInvoices = await tx.invoice.findMany({
          where: {
            id: { in: batch.invoices.map((row) => row.id) },
            cashSettlementLine: null,
          },
        });
        if (freshInvoices.length !== batch.invoices.length) {
          throw new Error("INVOICES_CHANGED");
        }

        await tx.receptionCashSettlement.update({
          where: { id: existing.id },
          data: {
            accountantId: params.gestionnaireId,
            systemTotalFcfa: existing.systemTotalFcfa + supplementGrossFcfa,
            physicalCashFcfa: existing.physicalCashFcfa + disburseAmount,
            disbursementFcfa: existing.disbursementFcfa + disburseAmount,
            varianceFcfa:
              existing.disbursementFcfa +
              disburseAmount -
              (existing.systemTotalFcfa + supplementGrossFcfa),
            comment: updatedComment || null,
          },
        });

        await tx.receptionCashSettlementLine.createMany({
          data: freshInvoices.map((invoice) => ({
            settlementId: existing.id,
            invoiceId: invoice.id,
          })),
        });

        await tx.auditLog.create({
          data: {
            userId: params.gestionnaireId,
            action: "GESTIONNAIRE_CASH_DISBURSE",
            entity: "ReceptionCashSettlement",
            entityId: existing.id,
            metadata: {
              registerId: params.registerId,
              cashierId: batch.cashierId,
              disbursementFcfa: disburseAmount,
              supplemented: true,
            },
          },
        });

        results.push(existing.id);
      });

      remaining -= disburseAmount;
      continue;
    }

    const disburseAmount = Math.min(remaining, batch.netTotalFcfa);

    await prisma.$transaction(async (tx) => {
      const freshInvoices = await tx.invoice.findMany({
        where: {
          id: { in: batch.invoices.map((row) => row.id) },
          cashSettlementLine: null,
        },
      });
      if (freshInvoices.length !== batch.invoices.length) {
        throw new Error("INVOICES_CHANGED");
      }

      const settlement = await tx.receptionCashSettlement.create({
        data: {
          receptionistId: batch.cashierId,
          accountantId: params.gestionnaireId,
          businessDate: batch.businessDate,
          shiftSlot: batch.shiftSlot,
          systemTotalFcfa: batch.systemTotalFcfa,
          physicalCashFcfa: disburseAmount,
          disbursementFcfa: disburseAmount,
          varianceFcfa: disburseAmount - batch.systemTotalFcfa,
          isCoherent: batch.expensesTotalFcfa === 0 && disburseAmount === batch.systemTotalFcfa,
          comment: mergedComment || null,
        },
      });

      await tx.receptionCashSettlementLine.createMany({
        data: freshInvoices.map((invoice) => ({
          settlementId: settlement.id,
          invoiceId: invoice.id,
        })),
      });

      await tx.auditLog.create({
        data: {
          userId: params.gestionnaireId,
          action: "GESTIONNAIRE_CASH_DISBURSE",
          entity: "ReceptionCashSettlement",
          entityId: settlement.id,
          metadata: {
            registerId: params.registerId,
            cashierId: batch.cashierId,
            disbursementFcfa: disburseAmount,
          },
        },
      });

      results.push(settlement.id);
    });

    remaining -= disburseAmount;
  }

  if (!results.length) throw new Error("NOTHING_DISBURSED");

  return {
    settlementIds: results,
    disbursedFcfa: params.disbursementFcfa - remaining,
    registerId: params.registerId,
    label: REGISTER_LABELS[params.registerId],
  };
}

export async function listDisbursementHistory(filters: {
  registerId?: CashRegisterId;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
}) {
  const fromDate = filters.from ? parseBusinessDate(filters.from) : null;
  const toDate = filters.to ? parseBusinessDate(filters.to) : null;
  if (toDate) toDate.setDate(toDate.getDate() + 1);

  const rows = await prisma.receptionCashSettlement.findMany({
    where: {
      ...(filters.minAmount != null || filters.maxAmount != null
        ? {
            disbursementFcfa: {
              ...(filters.minAmount != null ? { gte: filters.minAmount } : {}),
              ...(filters.maxAmount != null ? { lte: filters.maxAmount } : {}),
            },
          }
        : {}),
      ...(fromDate && toDate
        ? { settledAt: { gte: fromDate, lt: toDate } }
        : {}),
    },
    orderBy: { settledAt: "desc" },
    take: 500,
    include: {
      receptionist: { select: { firstName: true, lastName: true, role: true } },
      accountant: { select: { firstName: true, lastName: true } },
      _count: { select: { lines: true } },
    },
  });

  return rows
    .filter((row) => {
      if (!filters.registerId) return true;
      return registerForRole(row.receptionist.role) === filters.registerId;
    })
    .map((row) => ({
      id: row.id,
      settledAt: row.settledAt.toISOString(),
      businessDate: formatBusinessDate(row.businessDate),
      shiftSlot: row.shiftSlot,
      shiftLabel: SHIFT_SLOT_LABELS[row.shiftSlot],
      registerId: registerForRole(row.receptionist.role),
      registerLabel: REGISTER_LABELS[registerForRole(row.receptionist.role)],
      amountFcfa: row.disbursementFcfa,
      transactionCount: row._count.lines,
      cashierName: `${row.receptionist.firstName} ${row.receptionist.lastName}`.trim(),
      gestionnaireName: `${row.accountant.firstName} ${row.accountant.lastName}`.trim(),
      comment: row.comment,
    }));
}

export async function getDisbursementDetail(id: string) {
  const row = await prisma.receptionCashSettlement.findUnique({
    where: { id },
    include: {
      receptionist: { select: { firstName: true, lastName: true, role: true } },
      accountant: { select: { firstName: true, lastName: true } },
      lines: {
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              amountFcfa: true,
              type: true,
            },
          },
        },
      },
    },
  });
  if (!row) throw new Error("NOT_FOUND");

  const registerId = registerForRole(row.receptionist.role);
  return {
    id: row.id,
    settledAt: row.settledAt.toISOString(),
    businessDate: formatBusinessDate(row.businessDate),
    shiftSlot: row.shiftSlot,
    shiftLabel: SHIFT_SLOT_LABELS[row.shiftSlot],
    registerId,
    registerLabel: REGISTER_LABELS[registerId],
    amountFcfa: row.disbursementFcfa,
    transactionCount: row.lines.length,
    cashierName: `${row.receptionist.firstName} ${row.receptionist.lastName}`.trim(),
    gestionnaireName: `${row.accountant.firstName} ${row.accountant.lastName}`.trim(),
    comment: row.comment,
    transactions: row.lines.map((line) => ({
      id: line.invoice.id,
      invoiceNumber: line.invoice.invoiceNumber,
      typeLabel: INVOICE_TYPE_LABELS[line.invoice.type] ?? line.invoice.type,
      amountFcfa: line.invoice.amountFcfa,
    })),
  };
}

export async function updateDisbursementComment(
  id: string,
  comment: string,
  userId: string,
) {
  const row = await prisma.receptionCashSettlement.findUnique({ where: { id } });
  if (!row) throw new Error("NOT_FOUND");

  const updated = await prisma.receptionCashSettlement.update({
    where: { id },
    data: { comment: comment || null },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "UPDATE",
      entity: "ReceptionCashSettlement",
      entityId: id,
      metadata: { comment: comment || null },
    },
  });

  return getDisbursementDetail(updated.id);
}

export async function deleteDisbursementSettlement(id: string, userId: string) {
  const row = await prisma.receptionCashSettlement.findUnique({
    where: { id },
    include: { _count: { select: { lines: true } } },
  });
  if (!row) throw new Error("NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.receptionCashSettlement.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId,
        action: "DELETE",
        entity: "ReceptionCashSettlement",
        entityId: id,
        metadata: {
          disbursementFcfa: row.disbursementFcfa,
          transactionCount: row._count.lines,
        },
      },
    });
  });
}
