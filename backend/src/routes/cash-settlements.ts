import { Router } from "express";
import { z } from "zod";
import { InvoiceType, ReceptionShiftSlot, UserRole } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  CASH_COLLECTOR_ROLE_LABELS,
  CASH_COLLECTOR_ROLES,
  formatBusinessDate,
  formatShiftWindowLabel,
  getShiftWindow,
  isValidBusinessDate,
  parseBusinessDate,
  parseShiftSlot,
  SHIFT_SLOT_LABELS,
} from "../lib/cash-shift.js";
import { comptabiliteInvoicePatientWhere } from "../lib/patient-billing.js";
import {
  aggregateDayRoleTotals,
  COLLECTED_INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
  invoiceCollectedAt,
} from "../lib/revenue-stats.js";
import { buildSettlementBreakdown } from "../lib/cash-settlement-breakdown.js";
import { buildDayShiftReconciliation } from "../lib/day-shift-reconciliation.js";
import {
  aggregateCollectedForCashier,
  netAfterExpenses,
  sumExpensesForCashierOnDate,
  sumExpensesForCashierShift,
} from "../lib/cashier-personal-stats.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("comptabilite"));

const settlementSchema = z.object({
  receptionistId: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftSlot: z.enum(["MORNING", "EVENING", "NIGHT"]),
  physicalCashFcfa: z.coerce.number().int().min(0),
  disbursementFcfa: z.coerce.number().int().min(0),
  isCoherent: z.boolean(),
  comment: z.string().max(2000).optional(),
});

const disburseSchema = z.object({
  cashierId: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftSlot: z.enum(["MORNING", "EVENING", "NIGHT"]),
  comment: z.string().max(2000).optional(),
});

type InvoiceWithRelations = Awaited<ReturnType<typeof fetchUnsettledInvoices>>[number];

type CashierBucket = {
  cashier: { id: string; firstName: string; lastName: string; role: UserRole };
  roleLabel: string;
  systemTotalFcfa: number;
  expensesTotalFcfa: number;
  netTotalFcfa: number;
  expenses: Array<{ id: string; label: string; amountFcfa: number; createdAt: string }>;
  transactionCount: number;
  typeBreakdown: ReturnType<typeof buildSettlementBreakdown>;
};

function roleSortOrder(role: UserRole) {
  if (role === UserRole.COMPTABLE) return 0;
  if (role === UserRole.RECEPTIONNISTE) return 1;
  return 2;
}

async function fetchUnsettledInvoices(
  businessDate: Date,
  shiftSlot: ReceptionShiftSlot,
  cashierId?: string,
) {
  /** Fenêtre créneau [from, to) — ex. matin 7h–14h. Factures déjà liées à un décaissement exclues. */
  const { from, to } = getShiftWindow(businessDate, shiftSlot);

  return prisma.invoice.findMany({
    where: {
      type: { in: COLLECTED_INVOICE_TYPES },
      status: { not: "CANCELLED" },
      cashSettlementLine: null,
      issuedBy: {
        role: { in: CASH_COLLECTOR_ROLES },
        ...(cashierId ? { id: cashierId } : {}),
      },
      ...comptabiliteInvoicePatientWhere(),
      OR: [
        { status: "PAID", paidAt: { gte: from, lt: to } },
        {
          type: InvoiceType.CONSULTATION,
          status: "PENDING",
          createdAt: { gte: from, lt: to },
        },
      ],
    },
    include: {
      patient: { select: { code: true, firstName: true, lastName: true } },
      issuedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
      visit: { select: { consultation: { select: { clinicalNotes: true } } } },
      surgeryCase: { select: { id: true } },
      hospitalization: { select: { id: true } },
    },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
  });
}

function sumAmounts(invoices: { amountFcfa: number }[]) {
  return invoices.reduce((sum, invoice) => sum + invoice.amountFcfa, 0);
}

function groupInvoicesByCashier(invoices: InvoiceWithRelations[]): CashierBucket[] {
  const grouped = new Map<string, CashierBucket & { _invoices: InvoiceWithRelations[] }>();

  for (const invoice of invoices) {
    const cashier = invoice.issuedBy;
    if (!grouped.has(cashier.id)) {
      grouped.set(cashier.id, {
        cashier: {
          id: cashier.id,
          firstName: cashier.firstName,
          lastName: cashier.lastName,
          role: cashier.role,
        },
        roleLabel: CASH_COLLECTOR_ROLE_LABELS[cashier.role] ?? cashier.role,
        systemTotalFcfa: 0,
        expensesTotalFcfa: 0,
        netTotalFcfa: 0,
        expenses: [],
        transactionCount: 0,
        typeBreakdown: [],
        _invoices: [],
      });
    }
    const bucket = grouped.get(cashier.id)!;
    bucket._invoices.push(invoice);
    bucket.systemTotalFcfa += invoice.amountFcfa;
    bucket.transactionCount += 1;
  }

  return [...grouped.values()].map(({ _invoices, ...bucket }) => ({
    ...bucket,
    typeBreakdown: buildSettlementBreakdown(_invoices),
  })).sort((a, b) => {
    const roleDiff = roleSortOrder(a.cashier.role) - roleSortOrder(b.cashier.role);
    if (roleDiff !== 0) return roleDiff;
    return `${a.cashier.lastName} ${a.cashier.firstName}`.localeCompare(
      `${b.cashier.lastName} ${b.cashier.firstName}`,
      "fr",
    );
  });
}

async function attachExpensesToCashiers(
  cashiers: CashierBucket[],
  businessDate: Date,
  shiftSlot: ReceptionShiftSlot,
) {
  await Promise.all(
    cashiers.map(async (bucket) => {
      const summary = await sumExpensesForCashierShift(
        bucket.cashier.id,
        businessDate,
        shiftSlot,
      );
      bucket.expensesTotalFcfa = summary.totalFcfa;
      bucket.expenses = summary.rows;
      bucket.netTotalFcfa = netAfterExpenses(bucket.systemTotalFcfa, summary.totalFcfa);
    }),
  );
}

function sumRoleTotals(cashiers: CashierBucket[]) {
  let receptionFcfa = 0;
  let comptabiliteFcfa = 0;
  for (const row of cashiers) {
    if (row.cashier.role === UserRole.RECEPTIONNISTE) {
      receptionFcfa += row.systemTotalFcfa;
    } else {
      comptabiliteFcfa += row.systemTotalFcfa;
    }
  }
  return {
    receptionFcfa,
    comptabiliteFcfa,
    totalFcfa: receptionFcfa + comptabiliteFcfa,
  };
}

type SettlementWithRole = Awaited<ReturnType<typeof prisma.receptionCashSettlement.findMany>>[number] & {
  receptionist: { id: string; firstName: string; lastName: string; role: UserRole };
};

function sumSettledRoleTotals(settlements: SettlementWithRole[]) {
  let receptionFcfa = 0;
  let comptabiliteFcfa = 0;
  for (const row of settlements) {
    if (row.receptionist.role === UserRole.RECEPTIONNISTE) {
      receptionFcfa += row.disbursementFcfa;
    } else {
      comptabiliteFcfa += row.disbursementFcfa;
    }
  }
  return { receptionFcfa, comptabiliteFcfa, totalFcfa: receptionFcfa + comptabiliteFcfa };
}

function isReceptionRole(role: UserRole) {
  return role === UserRole.RECEPTIONNISTE;
}

function buildRoleGroups(
  cashiers: CashierBucket[],
  settlements: SettlementWithRole[],
  dayTotals: { receptionFcfa: number; comptabiliteFcfa: number },
) {
  const settledIds = new Set(settlements.map((row) => row.receptionistId));

  const buildGroup = (
    id: "reception" | "comptabilite",
    label: string,
    filter: (role: UserRole) => boolean,
    dayFcfa: number,
  ) => {
    const groupCashiers = cashiers.filter((row) => filter(row.cashier.role));
    const groupSettlements = settlements.filter((row) => filter(row.receptionist.role));
    const pendingTotalFcfa = groupCashiers.reduce((sum, row) => sum + row.netTotalFcfa, 0);
    const settledTotalFcfa = groupSettlements.reduce((sum, row) => sum + row.disbursementFcfa, 0);
    const pendingCashierCount = groupCashiers.length;

    return {
      id,
      label,
      dayTotalFcfa: dayFcfa,
      shiftPendingFcfa: pendingTotalFcfa,
      shiftSettledFcfa: settledTotalFcfa,
      shiftTotalFcfa: pendingTotalFcfa + settledTotalFcfa,
      cashierCount: groupCashiers.length + groupSettlements.filter(
        (row) => !groupCashiers.some((c) => c.cashier.id === row.receptionistId),
      ).length,
      pendingCashierCount,
      settledCount: groupSettlements.length,
      transactionCount: groupCashiers.reduce((sum, row) => sum + row.transactionCount, 0),
    };
  };

  return [
    buildGroup("reception", "Réception", isReceptionRole, dayTotals.receptionFcfa),
    buildGroup("comptabilite", "Comptabilité", (role) => !isReceptionRole(role), dayTotals.comptabiliteFcfa),
  ];
}

router.get("/pending", async (req, res) => {
  const user = req.user!;
  const businessDateIso =
    typeof req.query.businessDate === "string" ? req.query.businessDate : formatBusinessDate(new Date());
  const shiftSlot = parseShiftSlot(String(req.query.shiftSlot ?? "MORNING"));

  if (!isValidBusinessDate(businessDateIso) || !shiftSlot) {
    return res.status(400).json({ error: "Date ou créneau invalide" });
  }

  const businessDate = parseBusinessDate(businessDateIso);
  const { from, to } = getShiftWindow(businessDate, shiftSlot);

  const invoices = await fetchUnsettledInvoices(businessDate, shiftSlot);
  let cashiers = groupInvoicesByCashier(invoices);
  await attachExpensesToCashiers(cashiers, businessDate, shiftSlot);

  const existingSettlement = await prisma.receptionCashSettlement.findMany({
    where: { businessDate, shiftSlot },
    include: {
      receptionist: { select: { id: true, firstName: true, lastName: true, role: true } },
      accountant: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const pendingTotalFcfa = cashiers.reduce((sum, row) => sum + row.netTotalFcfa, 0);
  const pendingGrossFcfa = cashiers.reduce((sum, row) => sum + row.systemTotalFcfa, 0);
  const pendingExpensesFcfa = cashiers.reduce((sum, row) => sum + row.expensesTotalFcfa, 0);
  const settledTotalFcfa = existingSettlement.reduce((sum, row) => sum + row.disbursementFcfa, 0);
  const settledCashierIds = new Set(existingSettlement.map((row) => row.receptionistId));
  const shiftRoleTotals = sumRoleTotals(cashiers);
  const shiftSettledRoleTotals = sumSettledRoleTotals(existingSettlement);

  const dayEnd = new Date(businessDate);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const dayTotals = await aggregateDayRoleTotals(businessDate, dayEnd);
  const roleGroups = buildRoleGroups(cashiers, existingSettlement, {
    receptionFcfa: dayTotals.receptionFcfa,
    comptabiliteFcfa: dayTotals.comptabiliteFcfa,
  });
  const dayReconciliation = await buildDayShiftReconciliation(businessDate);

  const personalCollected = CASH_COLLECTOR_ROLES.includes(user.role)
    ? await aggregateCollectedForCashier(user.id, businessDate, dayEnd)
    : null;
  const personalExpenses = CASH_COLLECTOR_ROLES.includes(user.role)
    ? await sumExpensesForCashierOnDate(user.id, businessDate)
    : null;

  return res.json({
    businessDate: businessDateIso,
    shiftSlot,
    shiftLabel: SHIFT_SLOT_LABELS[shiftSlot],
    windowLabel: formatShiftWindowLabel(businessDate, shiftSlot),
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    currentUserId: user.id,
    summary: {
      cashierCount: cashiers.length,
      settledCount: existingSettlement.length,
      pendingCashierCount: cashiers.length,
      pendingTotalFcfa,
      pendingGrossFcfa,
      pendingExpensesFcfa,
      settledTotalFcfa,
      transactionCount: cashiers.reduce((sum, row) => sum + row.transactionCount, 0),
    },
    personalSummary: personalCollected
      ? {
          dayCollectedFcfa: personalCollected.totalFcfa,
          dayExpensesFcfa: personalExpenses?.totalFcfa ?? 0,
          dayNetFcfa: netAfterExpenses(
            personalCollected.totalFcfa,
            personalExpenses?.totalFcfa ?? 0,
          ),
        }
      : null,
    dayTotals: {
      totalFcfa: dayTotals.totalFcfa,
      receptionFcfa: dayTotals.receptionFcfa,
      comptabiliteFcfa: dayTotals.comptabiliteFcfa,
    },
    shiftRoleTotals,
    shiftSettledRoleTotals,
    shiftTotals: {
      pendingFcfa: pendingTotalFcfa,
      pendingGrossFcfa,
      pendingExpensesFcfa,
      settledFcfa: settledTotalFcfa,
      totalFcfa: pendingTotalFcfa + settledTotalFcfa,
    },
    roleGroups,
    dayReconciliation,
    /** @deprecated utiliser shiftRoleTotals */
    roleTotals: shiftRoleTotals,
    cashiers,
    /** @deprecated utiliser cashiers */
    receptionists: cashiers.map((row) => ({
      receptionist: row.cashier,
      roleLabel: row.roleLabel,
      systemTotalFcfa: row.systemTotalFcfa,
      expensesTotalFcfa: row.expensesTotalFcfa,
      netTotalFcfa: row.netTotalFcfa,
      expenses: row.expenses,
      transactionCount: row.transactionCount,
      typeBreakdown: row.typeBreakdown,
    })),
    settlements: existingSettlement.map((row) => ({
      id: row.id,
      receptionist: row.receptionist,
      cashier: row.receptionist,
      roleLabel: CASH_COLLECTOR_ROLE_LABELS[row.receptionist.role] ?? row.receptionist.role,
      accountant: row.accountant,
      systemTotalFcfa: row.systemTotalFcfa,
      physicalCashFcfa: row.physicalCashFcfa,
      disbursementFcfa: row.disbursementFcfa,
      varianceFcfa: row.varianceFcfa,
      isCoherent: row.isCoherent,
      comment: row.comment,
      settledAt: row.settledAt.toISOString(),
    })),
  });
});

router.get("/history", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const rows = await prisma.receptionCashSettlement.findMany({
    orderBy: [{ businessDate: "desc" }, { shiftSlot: "asc" }, { settledAt: "desc" }],
    take: limit,
    include: {
      receptionist: { select: { id: true, firstName: true, lastName: true, role: true } },
      accountant: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { lines: true } },
    },
  });

  return res.json(
    rows.map((row) => ({
      id: row.id,
      businessDate: formatBusinessDate(row.businessDate),
      shiftSlot: row.shiftSlot,
      shiftLabel: SHIFT_SLOT_LABELS[row.shiftSlot],
      receptionist: row.receptionist,
      cashier: row.receptionist,
      roleLabel: CASH_COLLECTOR_ROLE_LABELS[row.receptionist.role] ?? row.receptionist.role,
      accountant: row.accountant,
      systemTotalFcfa: row.systemTotalFcfa,
      physicalCashFcfa: row.physicalCashFcfa,
      disbursementFcfa: row.disbursementFcfa,
      varianceFcfa: row.varianceFcfa,
      isCoherent: row.isCoherent,
      comment: row.comment,
      invoiceCount: row._count.lines,
      settledAt: row.settledAt.toISOString(),
    })),
  );
});

router.post("/disburse", async (req, res) => {
  const user = req.user!;

  try {
    const body = disburseSchema.parse(req.body);
    const businessDate = parseBusinessDate(body.businessDate);
    const shiftSlot = body.shiftSlot as ReceptionShiftSlot;
    const comment = body.comment?.trim() || null;

    const collector = await prisma.user.findFirst({
      where: {
        id: body.cashierId,
        role: { in: CASH_COLLECTOR_ROLES },
        active: true,
      },
    });
    if (!collector) {
      return res.status(400).json({ error: "Caissier invalide" });
    }

    const existing = await prisma.receptionCashSettlement.findUnique({
      where: {
        receptionistId_businessDate_shiftSlot: {
          receptionistId: body.cashierId,
          businessDate,
          shiftSlot,
        },
      },
    });

    const invoices = await fetchUnsettledInvoices(businessDate, shiftSlot, body.cashierId);
    const systemTotalFcfa = sumAmounts(invoices);

    if (systemTotalFcfa === 0) {
      if (existing) {
        return res.status(400).json({ error: "Aucun encaissement complémentaire en attente pour ce caissier sur ce créneau." });
      }
      return res.status(400).json({ error: "Aucun encaissement en attente pour ce caissier sur ce créneau." });
    }

    const expenseSummary = await sumExpensesForCashierShift(
      body.cashierId,
      businessDate,
      shiftSlot,
    );

    const personLabel =
      collector.id === user.id ? "Votre compte" : `${collector.firstName} ${collector.lastName}`;

    if (existing) {
      const expensesAlreadyApplied = Math.max(0, existing.systemTotalFcfa - existing.disbursementFcfa);
      const incrementalExpenses = Math.max(0, expenseSummary.totalFcfa - expensesAlreadyApplied);
      const supplementNetFcfa = netAfterExpenses(systemTotalFcfa, incrementalExpenses);
      const expenseNote =
        incrementalExpenses > 0
          ? `Dépenses déduites (complément) : ${incrementalExpenses.toLocaleString("fr-FR")} FCFA`
          : null;
      const mergedComment = [expenseNote, comment].filter(Boolean).join(" — ") || null;
      const supplementNote = `Complément +${supplementNetFcfa.toLocaleString("fr-FR")} FCFA (${invoices.length} facture(s))`;
      const updatedComment = [existing.comment, supplementNote, mergedComment].filter(Boolean).join(" · ");

      const result = await prisma.$transaction(async (tx) => {
        const freshInvoices = await tx.invoice.findMany({
          where: {
            id: { in: invoices.map((inv) => inv.id) },
            cashSettlementLine: null,
          },
        });

        if (freshInvoices.length !== invoices.length) {
          throw new Error("INVOICES_CHANGED");
        }

        const updated = await tx.receptionCashSettlement.update({
          where: { id: existing.id },
          data: {
            systemTotalFcfa: existing.systemTotalFcfa + systemTotalFcfa,
            physicalCashFcfa: existing.physicalCashFcfa + supplementNetFcfa,
            disbursementFcfa: existing.disbursementFcfa + supplementNetFcfa,
            varianceFcfa:
              existing.disbursementFcfa +
              supplementNetFcfa -
              (existing.systemTotalFcfa + systemTotalFcfa),
            isCoherent: incrementalExpenses === 0 && existing.isCoherent,
            comment: updatedComment,
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
            userId: user.id,
            action: "CASH_SETTLEMENT_SUPPLEMENT",
            entity: "ReceptionCashSettlement",
            entityId: existing.id,
            metadata: {
              cashierId: body.cashierId,
              cashierRole: collector.role,
              businessDate: body.businessDate,
              shiftSlot,
              supplementGrossFcfa: systemTotalFcfa,
              supplementExpensesFcfa: incrementalExpenses,
              supplementDisbursementFcfa: supplementNetFcfa,
              invoiceCount: freshInvoices.length,
              comment: mergedComment,
            },
          },
        });

        return updated;
      });

      return res.status(200).json({
        id: result.id,
        disbursementFcfa: supplementNetFcfa,
        systemTotalFcfa,
        expensesTotalFcfa: incrementalExpenses,
        invoiceCount: invoices.length,
        supplemented: true,
        message: `Complément de ${supplementNetFcfa.toLocaleString("fr-FR")} FCFA validé — ${personLabel}.${incrementalExpenses > 0 ? ` (${incrementalExpenses.toLocaleString("fr-FR")} FCFA de dépenses déduites)` : ""}`,
      });
    }

    const netDisbursementFcfa = netAfterExpenses(systemTotalFcfa, expenseSummary.totalFcfa);
    const expenseNote =
      expenseSummary.totalFcfa > 0
        ? `Dépenses déduites : ${expenseSummary.totalFcfa.toLocaleString("fr-FR")} FCFA`
        : null;
    const mergedComment = [expenseNote, comment].filter(Boolean).join(" — ") || null;

    const result = await prisma.$transaction(async (tx) => {
      const freshInvoices = await tx.invoice.findMany({
        where: {
          id: { in: invoices.map((inv) => inv.id) },
          cashSettlementLine: null,
        },
      });

      if (freshInvoices.length !== invoices.length) {
        throw new Error("INVOICES_CHANGED");
      }

      const settlement = await tx.receptionCashSettlement.create({
        data: {
          receptionistId: body.cashierId,
          accountantId: user.id,
          businessDate,
          shiftSlot,
          systemTotalFcfa,
          physicalCashFcfa: netDisbursementFcfa,
          disbursementFcfa: netDisbursementFcfa,
          varianceFcfa: netDisbursementFcfa - systemTotalFcfa,
          isCoherent: expenseSummary.totalFcfa === 0,
          comment: mergedComment,
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
          userId: user.id,
          action: "CASH_SETTLEMENT",
          entity: "ReceptionCashSettlement",
          entityId: settlement.id,
          metadata: {
            cashierId: body.cashierId,
            cashierRole: collector.role,
            businessDate: body.businessDate,
            shiftSlot,
            systemTotalFcfa,
            expensesTotalFcfa: expenseSummary.totalFcfa,
            disbursementFcfa: netDisbursementFcfa,
            invoiceCount: freshInvoices.length,
            comment: mergedComment,
          },
        },
      });

      return settlement;
    });

    return res.status(201).json({
      id: result.id,
      disbursementFcfa: netDisbursementFcfa,
      systemTotalFcfa,
      expensesTotalFcfa: expenseSummary.totalFcfa,
      invoiceCount: invoices.length,
      message: `Décaissement de ${netDisbursementFcfa.toLocaleString("fr-FR")} FCFA validé — ${personLabel} soldé pour ce créneau.${expenseSummary.totalFcfa > 0 ? ` (${expenseSummary.totalFcfa.toLocaleString("fr-FR")} FCFA de dépenses déduites)` : ""}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    if (error instanceof Error && error.message === "INVOICES_CHANGED") {
      return res.status(409).json({ error: "Les encaissements ont changé. Actualisez et recommencez." });
    }
    console.error("[cash-settlements/disburse]", error);
    return res.status(400).json({ error: "Décaissement impossible" });
  }
});

router.get("/:id", async (req, res) => {
  const settlement = await prisma.receptionCashSettlement.findUnique({
    where: { id: req.params.id },
    include: {
      receptionist: { select: { id: true, firstName: true, lastName: true, role: true } },
      accountant: { select: { id: true, firstName: true, lastName: true } },
      lines: {
        include: {
          invoice: {
            include: {
              patient: { select: { code: true, firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  });

  if (!settlement) return res.status(404).json({ error: "Compte rendu introuvable" });

  return res.json({
    id: settlement.id,
    businessDate: formatBusinessDate(settlement.businessDate),
    shiftSlot: settlement.shiftSlot,
    shiftLabel: SHIFT_SLOT_LABELS[settlement.shiftSlot],
    receptionist: settlement.receptionist,
    cashier: settlement.receptionist,
    roleLabel: CASH_COLLECTOR_ROLE_LABELS[settlement.receptionist.role] ?? settlement.receptionist.role,
    accountant: settlement.accountant,
    systemTotalFcfa: settlement.systemTotalFcfa,
    physicalCashFcfa: settlement.physicalCashFcfa,
    disbursementFcfa: settlement.disbursementFcfa,
    varianceFcfa: settlement.varianceFcfa,
    isCoherent: settlement.isCoherent,
    comment: settlement.comment,
    settledAt: settlement.settledAt.toISOString(),
    invoices: settlement.lines.map((line) => ({
      id: line.invoice.id,
      invoiceNumber: line.invoice.invoiceNumber,
      type: line.invoice.type,
      typeLabel: INVOICE_TYPE_LABELS[line.invoice.type],
      amountFcfa: line.invoice.amountFcfa,
      patient: line.invoice.patient,
    })),
  });
});

router.post("/", async (req, res) => {
  const user = req.user!;

  try {
    const body = settlementSchema.parse(req.body);
    const businessDate = parseBusinessDate(body.businessDate);
    const shiftSlot = body.shiftSlot as ReceptionShiftSlot;

    const collector = await prisma.user.findFirst({
      where: {
        id: body.receptionistId,
        role: { in: CASH_COLLECTOR_ROLES },
        active: true,
      },
    });
    if (!collector) {
      return res.status(400).json({ error: "Caissier invalide" });
    }

    const existing = await prisma.receptionCashSettlement.findUnique({
      where: {
        receptionistId_businessDate_shiftSlot: {
          receptionistId: body.receptionistId,
          businessDate,
          shiftSlot,
        },
      },
    });
    if (existing) {
      return res.status(409).json({ error: "Ce compte rendu a déjà été validé pour ce créneau." });
    }

    const invoices = await fetchUnsettledInvoices(businessDate, shiftSlot, body.receptionistId);
    const systemTotalFcfa = sumAmounts(invoices);
    const varianceFcfa = body.physicalCashFcfa - systemTotalFcfa;
    const computedCoherent = varianceFcfa === 0 && body.disbursementFcfa === systemTotalFcfa;

    if (!body.isCoherent && (!body.comment || body.comment.trim().length < 3)) {
      return res.status(400).json({
        error: "Un commentaire est obligatoire en cas d'écart ou d'incohérence.",
      });
    }

    if (body.isCoherent && systemTotalFcfa > 0 && !computedCoherent) {
      return res.status(400).json({
        error: "Cohérence impossible : les montants ne correspondent pas au système.",
        systemTotalFcfa,
        varianceFcfa,
      });
    }

    if (body.disbursementFcfa !== body.physicalCashFcfa) {
      return res.status(400).json({
        error: "Le décaissement doit être égal aux espèces comptées remises.",
      });
    }

    if (systemTotalFcfa === 0 && body.disbursementFcfa > 0) {
      return res.status(400).json({ error: "Aucun encaissement en attente pour ce créneau." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const freshInvoices = await tx.invoice.findMany({
        where: {
          id: { in: invoices.map((inv) => inv.id) },
          cashSettlementLine: null,
        },
      });

      if (freshInvoices.length !== invoices.length) {
        throw new Error("INVOICES_CHANGED");
      }

      const freshTotal = sumAmounts(freshInvoices);
      if (freshTotal !== systemTotalFcfa) {
        throw new Error("TOTAL_CHANGED");
      }

      const settlement = await tx.receptionCashSettlement.create({
        data: {
          receptionistId: body.receptionistId,
          accountantId: user.id,
          businessDate,
          shiftSlot,
          systemTotalFcfa,
          physicalCashFcfa: body.physicalCashFcfa,
          disbursementFcfa: body.disbursementFcfa,
          varianceFcfa,
          isCoherent: body.isCoherent && (systemTotalFcfa === 0 || computedCoherent),
          comment: body.comment?.trim() || null,
        },
      });

      if (freshInvoices.length > 0) {
        await tx.receptionCashSettlementLine.createMany({
          data: freshInvoices.map((invoice) => ({
            settlementId: settlement.id,
            invoiceId: invoice.id,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "CASH_SETTLEMENT",
          entity: "ReceptionCashSettlement",
          entityId: settlement.id,
          metadata: {
            cashierId: body.receptionistId,
            cashierRole: collector.role,
            businessDate: body.businessDate,
            shiftSlot,
            systemTotalFcfa,
            physicalCashFcfa: body.physicalCashFcfa,
            disbursementFcfa: body.disbursementFcfa,
            varianceFcfa,
            isCoherent: body.isCoherent && (systemTotalFcfa === 0 || computedCoherent),
            invoiceCount: freshInvoices.length,
          },
        },
      });

      return settlement;
    });

    const personLabel =
      collector.id === user.id ? "Votre compte" : `${collector.firstName} ${collector.lastName}`;

    return res.status(201).json({
      id: result.id,
      systemTotalFcfa,
      physicalCashFcfa: body.physicalCashFcfa,
      disbursementFcfa: body.disbursementFcfa,
      varianceFcfa,
      invoiceCount: invoices.length,
      message: `Compte rendu validé — ${personLabel} soldé pour ce créneau.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    if (error instanceof Error && error.message === "INVOICES_CHANGED") {
      return res.status(409).json({ error: "Les encaissements ont changé. Actualisez et recommencez." });
    }
    if (error instanceof Error && error.message === "TOTAL_CHANGED") {
      return res.status(409).json({ error: "Le total système a changé. Actualisez et recommencez." });
    }
    console.error("[cash-settlements]", error);
    return res.status(400).json({ error: "Validation du compte rendu impossible" });
  }
});

export default router;
