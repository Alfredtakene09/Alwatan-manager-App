import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { z } from "zod";
import {
  ClinicExpenseCategory,
  ClinicExpenseStatus,
  PaymentMethod,
  PayrollStatus,
  ContractType,
  EmployeeContractStatus,
  DoctorCompensationType,
  ConsultationQuotaMode,
  ConsultationRenewalPolicy,
  UserRole,
  SalaryAdvanceStatus,
} from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireAuth, requireModule } from "../middleware/auth.js";
import { employeeCompensationData } from "../lib/doctor-compensation.js";
import {
  countEmployeesForJobTitle,
  serializeJobTitlesWithUsage,
  syncEmployeeJobTitles,
} from "../lib/employee-job-titles-sync.js";
import { buildGestionnaireDashboardOverview, buildGestionnaireNavBadges } from "../lib/gestionnaire-dashboard-stats.js";
import {
  disburseCashRegister,
  getCashRegisterDetail,
  getCashRegistersOverview,
  listDisbursementHistory,
  getDisbursementDetail,
  updateDisbursementComment,
  deleteDisbursementSettlement,
  type CashRegisterId,
} from "../lib/gestionnaire-cash.js";
import {
  buildJournalEntries,
  journalEntriesToCsv,
  parseJournalFiltersFromQuery,
} from "../lib/gestionnaire-journal.js";
import { buildAdminDashboardOverview } from "../lib/admin-dashboard-stats.js";
import { parseBusinessDate, formatBusinessDate } from "../lib/cash-shift.js";
import {
  currentPayrollPeriod,
  ensurePayrollForMonth,
  employeePayrollInclude,
  serializePayrollRow,
  countEligiblePayrollEmployees,
  fetchPayrollRowsForMonth,
  getPayrollPeriodSummaries,
} from "../lib/admin-payroll.js";
import {
  deductPendingAdvancesForPayroll,
  salaryAdvanceInclude,
  serializeSalaryAdvance,
  sumPendingAdvancesByEmployee,
} from "../lib/salary-advances.js";
import { employeeSelect, serializeEmployee, dedupeEmployeesForSelection } from "../lib/employee.js";
import { generateJournalDailyPdf, generatePayslipPdf } from "../lib/pdf-gestionnaire.js";
import { UPLOADS_ROOT } from "../lib/patient-dossier.js";
import { ROLE_LABELS } from "../lib/roles.js";

const router = Router();
router.use(requireAuth, requireModule("gestionnaire"));

const expenseUploadDir = path.join(UPLOADS_ROOT, "expenses");
fs.mkdirSync(expenseUploadDir, { recursive: true });

const expenseUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, expenseUploadDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.-]+/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const paymentMethodSchema = z.nativeEnum(PaymentMethod);

const employeeCompensationSchema = z.object({
  doctorCompensationType: z.nativeEnum(DoctorCompensationType).optional(),
  consultationTotalFcfa: z.number().int().min(0).optional(),
  consultationQuotaMode: z.nativeEnum(ConsultationQuotaMode).optional(),
  consultationQuotaPercent: z.number().int().min(1).max(99).optional(),
  consultationQuotaFcfa: z.number().int().min(0).optional(),
  consultationValidityDays: z.number().int().min(1).max(365).optional(),
  consultationRenewalPolicy: z.nativeEnum(ConsultationRenewalPolicy).optional(),
  surgeryQuotaPercent: z.number().int().min(1).max(99).optional(),
  fixedSalaryFcfa: z.number().int().min(0).optional(),
});

const gestionnaireEmployeeSchema = z
  .object({
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    phone: z.string().optional(),
    jobTitle: z.string().optional(),
    isMedecin: z.boolean().optional(),
    active: z.boolean().optional(),
    service: z.string().optional(),
    address: z.string().optional(),
    birthDate: z.string().optional(),
    hiredAt: z.string().optional(),
    contractType: z.nativeEnum(ContractType).optional(),
    contractStatus: z.nativeEnum(EmployeeContractStatus).optional(),
    bonusFcfa: z.coerce.number().int().min(0).optional(),
  })
  .merge(employeeCompensationSchema);

const jobTitleSchema = z.object({
  label: z.string().min(2).max(120),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

function employeeValidationMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (issue?.path.join(".") === "firstName" || issue?.path.join(".") === "lastName") {
      return "Le prénom et le nom doivent contenir au moins 2 caractères.";
    }
    return "Données invalides. Vérifiez les champs du formulaire.";
  }
  return "Données invalides";
}

const expenseSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(2),
  amountFcfa: z.coerce.number().int().positive(),
  expenseCategoryId: z.string().optional(),
  category: z.nativeEnum(ClinicExpenseCategory).optional(),
  beneficiary: z.string().optional(),
  paymentMethod: paymentMethodSchema.optional(),
  comment: z.string().optional(),
});

const categorySchema = z.object({
  name: z.string().min(2),
  icon: z.string().min(1).optional(),
  color: z.string().min(4).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const paySchema = z.object({
  paymentMethod: paymentMethodSchema,
  paidAt: z.string().optional(),
  remarks: z.string().optional(),
});

const payrollPeriodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const salaryAdvanceSchema = z.object({
  employeeId: z.string().min(1),
  amountFcfa: z.coerce.number().int().positive(),
  businessDate: z.string().min(1),
  comment: z.string().optional(),
});

const expenseUserSelect = { id: true, firstName: true, lastName: true, role: true } as const;

const gestionnaireExpenseInclude = {
  expenseCategory: true,
  recordedBy: { select: expenseUserSelect },
} as const;

function mapExpenseUserLabel(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

function serializeGestionnaireExpense(row: {
  id: string;
  businessDate: Date;
  amountFcfa: number;
  label: string;
  category: ClinicExpenseCategory;
  status: ClinicExpenseStatus;
  beneficiary: string | null;
  paymentMethod: PaymentMethod | null;
  receiptPath: string | null;
  comment: string | null;
  expenseCategoryId?: string | null;
  expenseCategory?: { id: string; name: string; icon: string; color: string } | null;
  recordedBy?: { firstName: string; lastName: string; role: keyof typeof ROLE_LABELS };
}) {
  const STATUS: Record<ClinicExpenseStatus, string> = {
    PENDING: "En attente",
    VALIDATED: "Validée",
    REJECTED: "Rejetée",
  };
  return {
    id: row.id,
    date: formatBusinessDate(row.businessDate),
    category: row.expenseCategory?.name ?? row.category,
    categoryIcon: row.expenseCategory?.icon ?? null,
    categoryColor: row.expenseCategory?.color ?? null,
    expenseCategoryId: row.expenseCategoryId ?? row.expenseCategory?.id ?? null,
    description: row.label,
    amountFcfa: row.amountFcfa,
    beneficiary: row.beneficiary,
    paymentMethod: row.paymentMethod,
    receiptPath: row.receiptPath,
    status: row.status,
    statusLabel: STATUS[row.status],
    comment: row.comment,
    recordedByName: row.recordedBy ? mapExpenseUserLabel(row.recordedBy) : null,
    recordedByRole: row.recordedBy?.role ?? null,
    recordedByRoleLabel: row.recordedBy ? ROLE_LABELS[row.recordedBy.role] : null,
  };
}

router.get("/dashboard", async (_req, res) => {
  return res.json(await buildGestionnaireDashboardOverview());
});

router.get("/nav-badges", async (_req, res) => {
  return res.json(await buildGestionnaireNavBadges());
});

router.get("/cash/registers", async (_req, res) => {
  const registers = await getCashRegistersOverview();
  const totalFcfa = registers.reduce((sum, row) => sum + row.balanceFcfa, 0);
  return res.json({ registers, totalFcfa });
});

router.get("/cash/registers/:id", async (req, res) => {
  const id = req.params.id as CashRegisterId;
  if (id !== "comptabilite") {
    return res.status(403).json({
      error: "Seule la caisse comptable est gérée par le gestionnaire.",
    });
  }
  try {
    return res.json(await getCashRegisterDetail(id));
  } catch (error) {
    if (error instanceof Error && error.message === "REGISTER_FORBIDDEN") {
      return res.status(403).json({ error: "Caisse non accessible." });
    }
    throw error;
  }
});

router.post("/cash/disburse", async (req, res) => {
  const user = req.user!;
  try {
    const body = z
      .object({
        registerId: z.literal("comptabilite"),
        disbursementFcfa: z.coerce.number().int().positive(),
        comment: z.string().max(2000).optional(),
      })
      .parse(req.body);

    const result = await disburseCashRegister({
      registerId: body.registerId,
      gestionnaireId: user.id,
      disbursementFcfa: body.disbursementFcfa,
      comment: body.comment,
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides" });
    }
    if (error instanceof Error) {
      if (error.message === "NO_PENDING") {
        return res.status(409).json({ error: "Aucun solde à décaisser pour cette caisse." });
      }
      if (error.message === "INVALID_AMOUNT") {
        return res.status(400).json({ error: "Montant invalide." });
      }
      if (error.message === "REGISTER_FORBIDDEN") {
        return res.status(403).json({ error: "Seule la caisse comptable peut être décaissée." });
      }
      if (error.message === "INVOICES_CHANGED") {
        return res.status(409).json({ error: "Les encaissements ont changé. Actualisez." });
      }
      if (error.message === "NOTHING_DISBURSED") {
        return res.status(409).json({
          error:
            "Aucun encaissement à récupérer : le compte rendu comptable couvre déjà ces créneaux. Actualisez la page.",
        });
      }
    }
    console.error("[gestionnaire/cash/disburse]", error);
    return res.status(400).json({ error: "Décaissement impossible" });
  }
});

router.get("/cash/history", async (req, res) => {
  const registerId =
    req.query.register === "reception" || req.query.register === "comptabilite"
      ? (req.query.register as CashRegisterId)
      : undefined;
  const rows = await listDisbursementHistory({
    registerId,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
    minAmount: req.query.minAmount ? Number(req.query.minAmount) : undefined,
    maxAmount: req.query.maxAmount ? Number(req.query.maxAmount) : undefined,
  });
  return res.json({ rows });
});

router.get("/cash/history/:id", async (req, res) => {
  try {
    return res.json(await getDisbursementDetail(req.params.id));
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Décaissement introuvable" });
    }
    throw error;
  }
});

router.patch("/cash/history/:id", async (req, res) => {
  const user = req.user!;
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  try {
    const row = await updateDisbursementComment(req.params.id, comment, user.id);
    return res.json(row);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Décaissement introuvable" });
    }
    throw error;
  }
});

router.delete("/cash/history/:id", async (req, res) => {
  const user = req.user!;
  try {
    await deleteDisbursementSettlement(req.params.id, user.id);
    return res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Décaissement introuvable" });
    }
    throw error;
  }
});

router.get("/cash/history/export.csv", async (req, res) => {
  const registerId =
    req.query.register === "reception" || req.query.register === "comptabilite"
      ? (req.query.register as CashRegisterId)
      : "comptabilite";
  const rows = await listDisbursementHistory({ registerId });
  const header = "Date;Caisse;Caissier;Montant;Transactions;Gestionnaire";
  const lines = rows.map((row) =>
    [
      new Date(row.settledAt).toLocaleString("fr-FR"),
      row.registerLabel,
      row.cashierName,
      row.amountFcfa,
      row.transactionCount,
      row.gestionnaireName,
    ].join(";"),
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="decaissements.csv"');
  return res.send([header, ...lines].join("\n"));
});

router.get("/journal", async (req, res) => {
  const filters = parseJournalFiltersFromQuery(req.query as Record<string, unknown>);
  const journal = await buildJournalEntries(filters);
  return res.json(journal);
});

router.get("/journal/export.csv", async (req, res) => {
  const filters = parseJournalFiltersFromQuery(req.query as Record<string, unknown>);
  const journal = await buildJournalEntries(filters);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="livre-journal.csv"');
  return res.send(journalEntriesToCsv(journal.entries));
});

router.get("/journal/export.pdf", async (req, res) => {
  const filters = parseJournalFiltersFromQuery(req.query as Record<string, unknown>);
  const journal = await buildJournalEntries(filters);
  const periodLabel =
    typeof req.query.periodLabel === "string" ? req.query.periodLabel : undefined;
  const filtersLabel =
    typeof req.query.filtersLabel === "string" ? req.query.filtersLabel : undefined;
  const pdf = await generateJournalDailyPdf(
    "Livre journal",
    journal.dailyByMonth,
    journal.totals,
    { periodLabel, filtersLabel },
  );
  const download = req.query.download === "1" || req.query.download === "true";
  const dateStamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename="livre-journal-${dateStamp}.pdf"`,
  );
  return res.send(pdf);
});

router.get("/expense-categories", async (_req, res) => {
  const rows = await prisma.expenseCategory.findMany({
    where: { archived: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return res.json(rows);
});

router.post("/expense-categories", async (req, res) => {
  const body = categorySchema.parse(req.body);
  const row = await prisma.expenseCategory.create({
    data: {
      name: body.name.trim(),
      icon: body.icon ?? "receipt",
      color: body.color ?? "#64748b",
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return res.status(201).json(row);
});

router.put("/expense-categories/:id", async (req, res) => {
  const body = categorySchema.partial().parse(req.body);
  const row = await prisma.expenseCategory.update({
    where: { id: req.params.id },
    data: {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.icon ? { icon: body.icon } : {}),
      ...(body.color ? { color: body.color } : {}),
      ...(body.sortOrder != null ? { sortOrder: body.sortOrder } : {}),
    },
  });
  return res.json(row);
});

router.delete("/expense-categories/:id", async (req, res) => {
  const id = req.params.id;
  const row = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error: "Catégorie introuvable" });

  await prisma.$transaction([
    prisma.clinicExpense.updateMany({
      where: { expenseCategoryId: id },
      data: { expenseCategoryId: null },
    }),
    prisma.expenseCategory.delete({ where: { id } }),
  ]);

  return res.status(204).send();
});

router.patch("/expense-categories/:id/archive", async (req, res) => {
  const archived = Boolean(req.body?.archived ?? true);
  const row = await prisma.expenseCategory.update({
    where: { id: req.params.id },
    data: { archived },
  });
  return res.json(row);
});

router.get("/expenses", async (req, res) => {
  const filter = typeof req.query.filter === "string" ? req.query.filter : "all";
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const where =
    filter === "pending"
      ? { status: ClinicExpenseStatus.PENDING }
      : filter === "month"
        ? { businessDate: { gte: monthStart, lt: monthEnd } }
        : {};

  const rows = await prisma.clinicExpense.findMany({
    where,
    include: gestionnaireExpenseInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json(rows.map(serializeGestionnaireExpense));
});

router.post("/expenses", expenseUpload.single("receipt"), async (req, res) => {
  const user = req.user!;
  try {
    const body = expenseSchema.parse(req.body);
    const row = await prisma.clinicExpense.create({
      data: {
        businessDate: parseBusinessDate(body.businessDate),
        amountFcfa: body.amountFcfa,
        label: body.label.trim(),
        category: body.category ?? ClinicExpenseCategory.AUTRE,
        expenseCategoryId: body.expenseCategoryId ?? null,
        beneficiary: body.beneficiary?.trim() || null,
        paymentMethod: body.paymentMethod ?? null,
        comment: body.comment?.trim() || null,
        receiptPath: req.file ? path.relative(UPLOADS_ROOT, req.file.path) : null,
        status: ClinicExpenseStatus.VALIDATED,
        paidById: user.id,
        recordedById: user.id,
        validatedById: user.id,
        validatedAt: new Date(),
      },
      include: gestionnaireExpenseInclude,
    });
    return res.status(201).json(serializeGestionnaireExpense(row));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides" });
    }
    return res.status(400).json({ error: "Enregistrement impossible" });
  }
});

router.put("/expenses/:id", expenseUpload.single("receipt"), async (req, res) => {
  const user = req.user!;
  const row = await prisma.clinicExpense.findUnique({
    where: { id: req.params.id },
    include: gestionnaireExpenseInclude,
  });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });

  try {
    const body = expenseSchema.parse(req.body);
    const updated = await prisma.clinicExpense.update({
      where: { id: row.id },
      data: {
        businessDate: parseBusinessDate(body.businessDate),
        amountFcfa: body.amountFcfa,
        label: body.label.trim(),
        category: body.category ?? row.category,
        expenseCategoryId: body.expenseCategoryId ?? null,
        beneficiary: body.beneficiary?.trim() || null,
        paymentMethod: body.paymentMethod ?? row.paymentMethod,
        comment: body.comment?.trim() || null,
        ...(req.file
          ? { receiptPath: path.relative(UPLOADS_ROOT, req.file.path) }
          : {}),
        validatedById: user.id,
        validatedAt: new Date(),
      },
      include: gestionnaireExpenseInclude,
    });
    return res.json(serializeGestionnaireExpense(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides" });
    }
    return res.status(400).json({ error: "Modification impossible" });
  }
});

router.delete("/expenses/:id", async (req, res) => {
  const row = await prisma.clinicExpense.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });

  if (row.receiptPath) {
    const absolute = path.join(UPLOADS_ROOT, row.receiptPath);
    try {
      fs.unlinkSync(absolute);
    } catch {
      /* fichier déjà absent */
    }
  }

  await prisma.clinicExpense.delete({ where: { id: row.id } });
  return res.status(204).send();
});

router.patch("/expenses/:id/validate", async (req, res) => {
  const user = req.user!;
  const row = await prisma.clinicExpense.findUnique({
    where: { id: req.params.id },
    include: { expenseCategory: true },
  });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });
  if (row.status !== ClinicExpenseStatus.PENDING) {
    return res.status(409).json({ error: "Dépense non modifiable" });
  }
  const updated = await prisma.clinicExpense.update({
    where: { id: row.id },
    data: {
      status: ClinicExpenseStatus.VALIDATED,
      validatedById: user.id,
      validatedAt: new Date(),
    },
    include: gestionnaireExpenseInclude,
  });
  return res.json(serializeGestionnaireExpense(updated));
});

router.patch("/expenses/:id/reject", async (req, res) => {
  const user = req.user!;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 3) {
    return res.status(400).json({ error: "Justification requise" });
  }
  const row = await prisma.clinicExpense.findUnique({
    where: { id: req.params.id },
    include: { expenseCategory: true },
  });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });
  const updated = await prisma.clinicExpense.update({
    where: { id: row.id },
    data: {
      status: ClinicExpenseStatus.REJECTED,
      rejectionReason: reason,
      validatedById: user.id,
      validatedAt: new Date(),
    },
    include: gestionnaireExpenseInclude,
  });
  return res.json(serializeGestionnaireExpense(updated));
});

router.get("/employees", async (req, res) => {
  const activeOnly = req.query.active !== "false";
  const forSelection = req.query.forSelection === "true";
  const rows = await prisma.employee.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: employeeSelect,
  });
  const serialized = rows.map(serializeEmployee);
  return res.json(forSelection ? dedupeEmployeesForSelection(serialized) : serialized);
});

router.get("/job-titles", async (req, res) => {
  const activeOnly = req.query.activeOnly !== "false";
  let items = await prisma.employeeJobTitle.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  if (items.length === 0) {
    await syncEmployeeJobTitles();
    items = await prisma.employeeJobTitle.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
  }

  return res.json(await serializeJobTitlesWithUsage(items));
});

router.post("/job-titles/sync", async (_req, res) => {
  const count = await syncEmployeeJobTitles();
  const items = await prisma.employeeJobTitle.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return res.json({ count, items: await serializeJobTitlesWithUsage(items) });
});

router.post("/job-titles", async (req, res) => {
  try {
    const body = jobTitleSchema.parse(req.body);
    const item = await prisma.employeeJobTitle.create({
      data: {
        label: body.label.trim(),
        active: body.active ?? true,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Poste invalide ou déjà existant." });
  }
});

router.put("/job-titles/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const body = jobTitleSchema.partial().parse(req.body);
    const existing = await prisma.employeeJobTitle.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Poste introuvable." });

    const nextLabel = body.label?.trim();
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.employeeJobTitle.update({
        where: { id },
        data: {
          label: nextLabel,
          active: body.active,
          sortOrder: body.sortOrder,
        },
      });

      if (nextLabel && nextLabel !== existing.label) {
        await tx.employee.updateMany({
          where: { jobTitle: existing.label },
          data: { jobTitle: nextLabel },
        });
      }

      return updated;
    });

    const [serialized] = await serializeJobTitlesWithUsage([item]);
    return res.json(serialized);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible — libellé invalide ou déjà utilisé." });
  }
});

router.delete("/job-titles/:id", async (req, res) => {
  const id = String(req.params.id);
  const item = await prisma.employeeJobTitle.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Poste introuvable." });

  const linkedCount = await countEmployeesForJobTitle(item.label);
  if (linkedCount > 0) {
    const suffix = linkedCount > 1 ? "employés utilisent" : "employé utilise";
    return res.status(409).json({
      error: `Suppression impossible : ${linkedCount} ${suffix} le poste « ${item.label} ».`,
      employeeCount: linkedCount,
    });
  }

  await prisma.employeeJobTitle.delete({ where: { id } });
  return res.json({ ok: true, message: `Le poste « ${item.label} » a été supprimé.` });
});

router.get("/employees/:id", async (req, res) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    select: {
      ...employeeSelect,
      birthDate: true,
      address: true,
      service: true,
      hiredAt: true,
      contractType: true,
      contractStatus: true,
      bonusFcfa: true,
      photoPath: true,
      payrolls: {
        where: { status: PayrollStatus.PAID },
        orderBy: [{ paidAt: "desc" }],
        take: 24,
      },
    },
  });
  if (!employee) return res.status(404).json({ error: "Employé introuvable" });
  return res.json(employee);
});

router.post("/employees", async (req, res) => {
  try {
    const body = gestionnaireEmployeeSchema.parse(req.body);
    const isMedecin = body.isMedecin ?? false;
    const row = await prisma.employee.create({
      data: {
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        phone: body.phone?.trim() || null,
        jobTitle: body.jobTitle?.trim() || null,
        service: body.service?.trim() || null,
        address: body.address?.trim() || null,
        birthDate: body.birthDate ? parseBusinessDate(body.birthDate) : null,
        hiredAt: body.hiredAt ? parseBusinessDate(body.hiredAt) : new Date(),
        contractType: body.contractType ?? null,
        contractStatus: body.contractStatus ?? EmployeeContractStatus.ACTIF,
        bonusFcfa: body.bonusFcfa ?? null,
        isMedecin,
        active: body.active ?? true,
        ...employeeCompensationData(isMedecin, body),
      },
      select: employeeSelect,
    });
    return res.status(201).json(serializeEmployee(row));
  } catch (error) {
    return res.status(400).json({ error: employeeValidationMessage(error) });
  }
});

router.put("/employees/:id", async (req, res) => {
  try {
    const employeeId = String(req.params.id);
    const body = gestionnaireEmployeeSchema.partial().parse(req.body);
    const existing = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: { select: { role: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Employé introuvable" });

    const nextIsMedecin = body.isMedecin ?? existing.isMedecin;
    if (existing.user?.role === UserRole.MEDECIN && !nextIsMedecin) {
      return res.status(409).json({
        error: "Impossible de retirer le statut médecin : un compte utilisateur médecin y est lié.",
      });
    }

    const compensationInput =
      body.isMedecin !== undefined ||
      body.doctorCompensationType !== undefined ||
      body.consultationTotalFcfa !== undefined ||
      body.consultationQuotaPercent !== undefined ||
      body.surgeryQuotaPercent !== undefined ||
      body.fixedSalaryFcfa !== undefined
        ? employeeCompensationData(nextIsMedecin, body)
        : {};

    const row = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        ...(body.firstName ? { firstName: body.firstName.trim() } : {}),
        ...(body.lastName ? { lastName: body.lastName.trim() } : {}),
        ...(body.phone !== undefined ? { phone: body.phone?.trim() || null } : {}),
        ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle?.trim() || null } : {}),
        ...(body.service !== undefined ? { service: body.service?.trim() || null } : {}),
        ...(body.address !== undefined ? { address: body.address?.trim() || null } : {}),
        ...(body.birthDate !== undefined
          ? { birthDate: body.birthDate ? parseBusinessDate(body.birthDate) : null }
          : {}),
        ...(body.hiredAt !== undefined
          ? { hiredAt: body.hiredAt ? parseBusinessDate(body.hiredAt) : null }
          : {}),
        ...(body.contractType !== undefined ? { contractType: body.contractType } : {}),
        ...(body.contractStatus !== undefined ? { contractStatus: body.contractStatus } : {}),
        ...(body.bonusFcfa !== undefined ? { bonusFcfa: body.bonusFcfa } : {}),
        ...(body.isMedecin !== undefined ? { isMedecin: body.isMedecin } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...compensationInput,
      },
      select: employeeSelect,
    });

    if (body.firstName || body.lastName) {
      await prisma.user.updateMany({
        where: { employeeId },
        data: {
          firstName: row.firstName,
          lastName: row.lastName,
        },
      });
    }

    return res.json(serializeEmployee(row));
  } catch (error) {
    return res.status(400).json({ error: employeeValidationMessage(error) });
  }
});

router.delete("/employees/:id", async (req, res) => {
  const employeeId = String(req.params.id);
  const existing = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { id: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Employé introuvable" });
  if (existing.user) {
    return res.status(409).json({
      error: "Impossible de supprimer cet employé : un compte application y est lié. Supprimez d'abord le compte.",
    });
  }

  await prisma.employee.delete({ where: { id: employeeId } });
  return res.json({
    ok: true,
    message: `L'employé « ${existing.firstName} ${existing.lastName} » a été supprimé.`,
  });
});

router.get("/payroll/periods", async (_req, res) => {
  const periods = await getPayrollPeriodSummaries();
  const eligibleCount = await countEligiblePayrollEmployees();
  return res.json({ periods, eligibleCount });
});

async function buildPayrollMonthResponse(targetYear: number, targetMonth: number) {
  const rows = await fetchPayrollRowsForMonth(targetYear, targetMonth);
  const pendingMap = await sumPendingAdvancesByEmployee(rows.map((row) => row.employeeId));
  const serialized = rows.map((row) =>
    serializePayrollRow(row, {
      pendingAdvancesFcfa: pendingMap.get(row.employeeId) ?? 0,
    }),
  );
  const paidCount = serialized.filter((row) => row.status === PayrollStatus.PAID).length;
  const unpaidCount = serialized.length - paidCount;
  const unpaidNetFcfa = serialized
    .filter((row) => row.status !== PayrollStatus.PAID)
    .reduce((sum, row) => sum + row.netFcfa, 0);

  return {
    year: targetYear,
    month: targetMonth,
    prepared: serialized.length > 0,
    eligibleCount: await countEligiblePayrollEmployees(),
    paidCount,
    unpaidCount,
    unpaidNetFcfa,
    rows: serialized,
  };
}

router.get("/payroll", async (req, res) => {
  const { year, month } = currentPayrollPeriod();
  const targetYear = Number(req.query.year) || year;
  const targetMonth = Number(req.query.month) || month;
  return res.json(await buildPayrollMonthResponse(targetYear, targetMonth));
});

router.post("/payroll/prepare", async (req, res) => {
  const { year, month } = payrollPeriodSchema.parse(req.body);
  const result = await ensurePayrollForMonth(year, month);
  if (!result.total) {
    return res.status(400).json({
      error: "Aucun employé éligible — définissez un salaire fixe sur les fiches employés.",
    });
  }
  return res.json(await buildPayrollMonthResponse(year, month));
});

router.post("/payroll/unprepare", async (req, res) => {
  const { year, month } = payrollPeriodSchema.parse(req.body);
  const paidCount = await prisma.employeePayroll.count({
    where: { year, month, status: PayrollStatus.PAID },
  });
  if (paidCount > 0) {
    return res.status(409).json({
      error: "Impossible d'annuler : certains salaires de cette période sont déjà payés.",
    });
  }

  await prisma.employeePayroll.deleteMany({
    where: { year, month },
  });
  return res.json(await buildPayrollMonthResponse(year, month));
});

router.get("/payroll/history", async (req, res) => {
  const queryYear = Number(req.query.year);
  const queryMonth = Number(req.query.month);
  const service =
    typeof req.query.service === "string" && req.query.service !== "all"
      ? req.query.service
      : undefined;
  const search =
    typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

  const rows = await prisma.employeePayroll.findMany({
    where: {
      status: PayrollStatus.PAID,
      ...(Number.isFinite(queryYear) ? { year: queryYear } : {}),
      ...(Number.isFinite(queryMonth) ? { month: queryMonth } : {}),
    },
    include: employeePayrollInclude,
    orderBy: [{ paidAt: "desc" }],
    take: 500,
  });

  let serialized = rows.map((row) => ({
    ...serializePayrollRow(row),
    paidAt: row.paidAt?.toISOString() ?? null,
  }));

  if (service) {
    serialized = serialized.filter((row) => row.employee.service === service);
  }
  if (search) {
    serialized = serialized.filter((row) => {
      const haystack = [
        row.employee.fullName,
        row.employee.jobTitle ?? "",
        row.employee.service,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  return res.json({ rows: serialized });
});

router.post("/payroll/:id/pay", async (req, res) => {
  const user = req.user!;
  const body = paySchema.parse(req.body);
  const row = await prisma.employeePayroll.findUnique({
    where: { id: req.params.id },
    include: employeePayrollInclude,
  });
  if (!row) return res.status(404).json({ error: "Fiche introuvable" });
  if (row.status === PayrollStatus.PAID) {
    return res.status(409).json({ error: "Déjà payé" });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const advanceDeductionFcfa = await deductPendingAdvancesForPayroll(
      tx,
      row.employeeId,
      row.year,
      row.month,
    );
    return tx.employeePayroll.update({
      where: { id: row.id },
      data: {
        status: PayrollStatus.PAID,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        paidById: user.id,
        paymentMethod: body.paymentMethod,
        remarks: body.remarks?.trim() || null,
        primeFcfa: 0,
        advanceDeductionFcfa,
      },
      include: employeePayrollInclude,
    });
  });
  const pendingMap = await sumPendingAdvancesByEmployee([updated.employeeId]);
  return res.json(
    serializePayrollRow(updated, {
      pendingAdvancesFcfa: pendingMap.get(updated.employeeId) ?? 0,
    }),
  );
});

router.get("/salary-advances", async (req, res) => {
  const statusParam = req.query.status;
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const status =
    statusParam === "PENDING" ||
    statusParam === "DEDUCTED" ||
    statusParam === "CANCELLED"
      ? statusParam
      : undefined;

  const rows = await prisma.salaryAdvance.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(employeeId ? { employeeId } : {}),
    },
    include: salaryAdvanceInclude,
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return res.json(rows.map(serializeSalaryAdvance));
});

router.post("/salary-advances", async (req, res) => {
  const user = req.user!;
  const body = salaryAdvanceSchema.parse(req.body);
  const employee = await prisma.employee.findUnique({
    where: { id: body.employeeId },
    select: { id: true, active: true },
  });
  if (!employee) return res.status(404).json({ error: "Employé introuvable" });
  if (!employee.active) {
    return res.status(400).json({ error: "Cet employé est inactif." });
  }

  const row = await prisma.salaryAdvance.create({
    data: {
      employeeId: body.employeeId,
      amountFcfa: body.amountFcfa,
      businessDate: parseBusinessDate(body.businessDate),
      comment: body.comment?.trim() || null,
      recordedById: user.id,
    },
    include: salaryAdvanceInclude,
  });
  return res.status(201).json(serializeSalaryAdvance(row));
});

router.patch("/salary-advances/:id/cancel", async (req, res) => {
  const row = await prisma.salaryAdvance.findUnique({
    where: { id: req.params.id },
    include: salaryAdvanceInclude,
  });
  if (!row) return res.status(404).json({ error: "Avance introuvable" });
  if (row.status !== SalaryAdvanceStatus.PENDING) {
    return res.status(409).json({ error: "Seules les avances en attente peuvent être annulées." });
  }

  const updated = await prisma.salaryAdvance.update({
    where: { id: row.id },
    data: { status: SalaryAdvanceStatus.CANCELLED },
    include: salaryAdvanceInclude,
  });
  return res.json(serializeSalaryAdvance(updated));
});

router.get("/payroll/:id/payslip.pdf", async (req, res) => {
  const user = req.user!;
  const row = await prisma.employeePayroll.findUnique({
    where: { id: req.params.id },
    include: employeePayrollInclude,
  });
  if (!row) return res.status(404).json({ error: "Fiche introuvable" });
  const pdf = await generatePayslipPdf({
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
    jobTitle: row.employee.jobTitle,
    year: row.year,
    month: row.month,
    grossFcfa: row.grossFcfa,
    advanceDeductionFcfa: row.advanceDeductionFcfa,
    netFcfa: Math.max(0, row.grossFcfa - row.advanceDeductionFcfa),
    gestionnaireName: `${user.firstName} ${user.lastName}`.trim(),
  });
  res.setHeader("Content-Type", "application/pdf");
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disposition}; filename="fiche-paie-${row.id}.pdf"`);
  return res.send(pdf);
});

router.get("/finances", async (_req, res) => {
  const overview = await buildAdminDashboardOverview();
  return res.json({
    financialKpis: overview.financialKpis,
    monthlyTrend: overview.monthlyTrend,
    revenueBreakdown: overview.revenueBreakdown,
    expenseBreakdown: overview.expenseBreakdown,
  });
});

router.get("/supervision", async (_req, res) => {
  const overview = await buildAdminDashboardOverview();
  return res.json(overview.clinical);
});

export default router;
