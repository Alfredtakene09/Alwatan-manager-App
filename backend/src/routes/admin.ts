import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  ClinicExpenseCategory,
  ClinicExpenseStatus,
  InterventionCategory,
  PayrollStatus,
  UserRole,
  DoctorCompensationType,
  ConsultationQuotaMode,
  ConsultationRenewalPolicy,
  ReceptionShiftSlot,
} from "@prisma/client";
import { parseShiftSlot } from "../lib/cash-shift.js";
import { prisma } from "../lib/db.js";
import { MANAGEABLE_USER_ROLES } from "../lib/roles.js";
import { employeeCompensationData } from "../lib/doctor-compensation.js";
import { employeeSelect, serializeEmployee } from "../lib/employee.js";
import {
  countEmployeesForJobTitle,
  serializeJobTitlesWithUsage,
  syncEmployeeJobTitles,
} from "../lib/employee-job-titles-sync.js";
import { countUserRelatedData, userDeletionBlockedMessage } from "../lib/user-deletion.js";
import {
  findDuplicateIntervention,
  findDuplicateProduct,
  findDuplicateRoomByName,
} from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { requireAuth, requireModule } from "../middleware/auth.js";
import {
  currentPayrollPeriod,
  ensurePayrollForMonth,
  employeePayrollInclude,
  serializePayrollRow,
} from "../lib/admin-payroll.js";
import {
  deductPendingAdvancesForPayroll,
  sumPendingAdvancesByEmployee,
} from "../lib/salary-advances.js";
import { parseBusinessDate, formatBusinessDate } from "../lib/cash-shift.js";

const router = Router();
router.use(requireAuth);

const EXPENSE_CATEGORY_LABELS: Record<ClinicExpenseCategory, string> = {
  FOURNITURES: "Fournitures",
  TRANSPORT: "Transport / course",
  MAINTENANCE: "Maintenance",
  ACHAT_URGENT: "Équipements",
  AUTRE: "Autre",
};

const EXPENSE_STATUS_LABELS: Record<ClinicExpenseStatus, string> = {
  PENDING: "En attente",
  VALIDATED: "Validée",
  REJECTED: "Rejetée",
};

const interventionSchema = z.object({
  code: z.string().min(2),
  label: z.string().min(2),
  category: z.nativeEnum(InterventionCategory),
  totalCostFcfa: z.number().int().positive(),
  surgeonPercent: z.number().int().min(1).max(99),
  active: z.boolean().optional(),
});

const productSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(2),
  quantity: z.number().int().min(0),
  unitPriceFcfa: z.number().int().positive(),
  minStock: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const roomSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["VIP", "SIMPLE"]),
  description: z.string().optional(),
  dailyRateFcfa: z.number().int().positive(),
  active: z.boolean().optional(),
});

const manageableRoleSchema = z.enum(MANAGEABLE_USER_ROLES);

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

const createEmployeeSchema = z
  .object({
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    phone: z.string().optional(),
    jobTitle: z.string().optional(),
    isMedecin: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .merge(employeeCompensationSchema);

const updateEmployeeSchema = createEmployeeSchema.partial();

const cashShiftSlotSchema = z.enum(["MORNING", "EVENING", "NIGHT"]);

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "Le nom d'utilisateur doit contenir au moins 2 caractères.")
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Caractères autorisés : lettres, chiffres, . _ -"),
  email: z.string().email().optional(),
  password: z.string().min(6),
  role: manageableRoleSchema,
  employeeId: z.string().min(1),
  cashShiftSlot: cashShiftSlotSchema.optional().nullable(),
});

const updateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: manageableRoleSchema.optional(),
  active: z.boolean().optional(),
  employeeId: z.string().min(1).optional(),
  cashShiftSlot: cashShiftSlotSchema.optional().nullable(),
});

const jobTitleSchema = z.object({
  label: z.string().min(2).max(120),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const userSelect = {
  id: true,
  username: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  active: true,
  employeeId: true,
  cashShiftSlot: true,
  createdAt: true,
  updatedAt: true,
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      isMedecin: true,
    },
  },
} as const;

function resolveCashShiftSlotForRole(
  role: UserRole,
  cashShiftSlot: string | null | undefined,
): ReceptionShiftSlot | null {
  if (role !== UserRole.RECEPTIONNISTE) return null;
  return parseShiftSlot(String(cashShiftSlot ?? "")) ?? null;
}

function serializeUser(
  user: {
    id: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    active: boolean;
    employeeId: string;
    cashShiftSlot: ReceptionShiftSlot | null;
    createdAt: Date;
    updatedAt: Date;
    employee: {
      id: string;
      firstName: string;
      lastName: string;
      jobTitle: string | null;
      isMedecin: boolean;
    };
  },
  meta?: { canDelete?: boolean; relatedDataCount?: number },
) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    active: user.active,
    employeeId: user.employeeId,
    cashShiftSlot: user.cashShiftSlot,
    employee: user.employee,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    canDelete: meta?.canDelete ?? false,
    relatedDataCount: meta?.relatedDataCount ?? 0,
  };
}

async function validateEmployeeForUser(
  employeeId: string,
  role: UserRole,
  currentUserId?: string,
) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { id: true } } },
  });
  if (!employee) {
    return { error: "Employé introuvable." as const };
  }
  if (!employee.active) {
    return { error: "Cet employé est inactif." as const };
  }
  if (employee.user && employee.user.id !== currentUserId) {
    return { error: "Cet employé est déjà lié à un compte utilisateur." as const };
  }
  if (role === UserRole.MEDECIN && !employee.isMedecin) {
    return { error: "Un compte médecin doit être lié à un employé médecin." as const };
  }
  return { employee };
}

router.get("/employees", requireModule("utilisateurs"), async (req, res) => {
  const unlinkedOnly = req.query.unlinked === "true";
  const activeOnly = req.query.active !== "false";

  const employees = await prisma.employee.findMany({
    where: {
      ...(activeOnly ? { active: true } : {}),
      ...(unlinkedOnly ? { user: { is: null } } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: employeeSelect,
  });

  return res.json(employees.map(serializeEmployee));
});

router.get("/job-titles", requireModule("utilisateurs"), async (req, res) => {
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

router.post("/job-titles/sync", requireModule("utilisateurs"), async (_req, res) => {
  const count = await syncEmployeeJobTitles();
  const items = await prisma.employeeJobTitle.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return res.json({ count, items: await serializeJobTitlesWithUsage(items) });
});

router.post("/job-titles", requireModule("utilisateurs"), async (req, res) => {
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

router.put("/job-titles/:id", requireModule("utilisateurs"), async (req, res) => {
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

router.delete("/job-titles/:id", requireModule("utilisateurs"), async (req, res) => {
  const id = String(req.params.id);
  const item = await prisma.employeeJobTitle.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Poste introuvable." });

  const linkedCount = await countEmployeesForJobTitle(item.label);
  if (linkedCount > 0) {
    const suffix = linkedCount > 1 ? "employés utilisent" : "employé utilise";
    return res.status(409).json({
      error: `Suppression impossible : ${linkedCount} ${suffix} le poste « ${item.label} ». Modifiez d'abord la fiche de ces employés ou désactivez le poste.`,
      employeeCount: linkedCount,
    });
  }

  await prisma.employeeJobTitle.delete({ where: { id } });
  return res.json({ ok: true, message: `Le poste « ${item.label} » a été supprimé.` });
});

router.post("/employees", requireModule("utilisateurs"), async (req, res) => {
  try {
    const body = createEmployeeSchema.parse(req.body);
    const isMedecin = body.isMedecin ?? false;
    const employee = await prisma.employee.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone?.trim() || null,
        jobTitle: body.jobTitle?.trim() || null,
        isMedecin,
        active: body.active ?? true,
        ...employeeCompensationData(isMedecin, body),
      },
      select: employeeSelect,
    });
    return res.status(201).json(serializeEmployee(employee));
  } catch (error) {
    return res.status(400).json({ error: employeeValidationMessage(error) });
  }
});

router.put("/employees/:id", requireModule("utilisateurs"), async (req, res) => {
  try {
    const employeeId = String(req.params.id);
    const body = updateEmployeeSchema.parse(req.body);
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

    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone === undefined ? undefined : body.phone.trim() || null,
        jobTitle: body.jobTitle === undefined ? undefined : body.jobTitle.trim() || null,
        isMedecin: body.isMedecin,
        active: body.active,
        ...compensationInput,
      },
      select: employeeSelect,
    });

    if (body.firstName || body.lastName) {
      await prisma.user.updateMany({
        where: { employeeId },
        data: {
          firstName: employee.firstName,
          lastName: employee.lastName,
        },
      });
    }

    return res.json(serializeEmployee(employee));
  } catch (error) {
    return res.status(400).json({ error: employeeValidationMessage(error) });
  }
});

router.delete("/employees/:id", requireModule("utilisateurs"), async (req, res) => {
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

router.get("/users", requireModule("utilisateurs"), async (req, res) => {
  const role = req.query.role as string | undefined;
  const roleFilter = role && MANAGEABLE_USER_ROLES.includes(role as (typeof MANAGEABLE_USER_ROLES)[number])
    ? (role as UserRole)
    : undefined;

  const users = await prisma.user.findMany({
    where: {
      role: roleFilter ?? { in: [...MANAGEABLE_USER_ROLES] },
    },
    orderBy: [{ role: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    select: userSelect,
  });

  const currentUserId = req.user!.id;
  const enriched = await Promise.all(
    users.map(async (user) => {
      const relatedDataCount = await countUserRelatedData(user.id);
      const canDelete = user.id !== currentUserId && relatedDataCount === 0;
      return serializeUser(user, { canDelete, relatedDataCount });
    }),
  );

  return res.json(enriched);
});

router.post("/users", requireModule("utilisateurs"), async (req, res) => {
  try {
    const body = createUserSchema.parse(req.body);
    const existingUsername = await prisma.user.findUnique({ where: { username: body.username } });
    if (existingUsername) {
      return res.status(409).json({ error: "Ce nom d'utilisateur est déjà utilisé." });
    }

    const email = body.email?.trim() || `${body.username}@alwatan.local`;
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return res.status(409).json({ error: "Cet e-mail est déjà utilisé." });
    }

    const employeeCheck = await validateEmployeeForUser(body.employeeId, body.role);
    if ("error" in employeeCheck) {
      return res.status(400).json({ error: employeeCheck.error });
    }

    const cashShiftSlot = resolveCashShiftSlotForRole(body.role, body.cashShiftSlot);
    if (body.role === UserRole.RECEPTIONNISTE && !cashShiftSlot) {
      return res.status(400).json({
        error: "Sélectionnez le créneau caisse du réceptionniste (matin, soir ou nuit).",
      });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        username: body.username,
        email,
        passwordHash,
        firstName: employeeCheck.employee.firstName,
        lastName: employeeCheck.employee.lastName,
        role: body.role,
        employeeId: body.employeeId,
        cashShiftSlot,
      },
      select: userSelect,
    });

    return res.status(201).json(serializeUser(user));
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.put("/users/:id", requireModule("utilisateurs"), async (req, res) => {
  try {
    const userId = String(req.params.id);
    const body = updateUserSchema.parse(req.body);
    const currentUser = req.user!;

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) return res.status(404).json({ error: "Utilisateur introuvable" });
    if (!MANAGEABLE_USER_ROLES.includes(existing.role as (typeof MANAGEABLE_USER_ROLES)[number])) {
      return res.status(403).json({ error: "Cet utilisateur ne peut pas être modifié." });
    }

    if (body.username && body.username !== existing.username) {
      const usernameTaken = await prisma.user.findUnique({ where: { username: body.username } });
      if (usernameTaken) return res.status(409).json({ error: "Ce nom d'utilisateur est déjà utilisé." });
    }

    if (body.email && body.email !== existing.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: body.email } });
      if (emailTaken) return res.status(409).json({ error: "Cet e-mail est déjà utilisé." });
    }

    if (body.active === false && userId === currentUser.id) {
      return res.status(409).json({ error: "Vous ne pouvez pas désactiver votre propre compte." });
    }

    const nextRole = body.role ?? existing.role;
    let employeeNames: { firstName: string; lastName: string } | undefined;
    if (body.employeeId && body.employeeId !== existing.employeeId) {
      const employeeCheck = await validateEmployeeForUser(body.employeeId, nextRole, userId);
      if ("error" in employeeCheck) {
        return res.status(400).json({ error: employeeCheck.error });
      }
      employeeNames = {
        firstName: employeeCheck.employee.firstName,
        lastName: employeeCheck.employee.lastName,
      };
    }

    const cashShiftSlot =
      body.cashShiftSlot !== undefined || body.role !== undefined
        ? resolveCashShiftSlotForRole(
            nextRole,
            body.cashShiftSlot !== undefined ? body.cashShiftSlot : existing.cashShiftSlot,
          )
        : undefined;
    if (nextRole === UserRole.RECEPTIONNISTE && cashShiftSlot === null) {
      return res.status(400).json({
        error: "Sélectionnez le créneau caisse du réceptionniste (matin, soir ou nuit).",
      });
    }

    const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : undefined;
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        username: body.username,
        email: body.email,
        role: body.role,
        active: body.active,
        employeeId: body.employeeId,
        ...(cashShiftSlot !== undefined ? { cashShiftSlot } : {}),
        ...(employeeNames ?? {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: userSelect,
    });

    return res.json(serializeUser(user));
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/users/:id", requireModule("utilisateurs"), async (req, res) => {
  const userId = String(req.params.id);
  const currentUser = req.user!;

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) return res.status(404).json({ error: "Utilisateur introuvable" });
  if (!MANAGEABLE_USER_ROLES.includes(existing.role as (typeof MANAGEABLE_USER_ROLES)[number])) {
    return res.status(403).json({ error: "Cet utilisateur ne peut pas être supprimé." });
  }
  if (userId === currentUser.id) {
    return res.status(409).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
  }

  const relatedDataCount = await countUserRelatedData(userId);
  if (relatedDataCount > 0) {
    return res.status(409).json({
      error: userDeletionBlockedMessage(relatedDataCount),
      relatedDataCount,
    });
  }

  await prisma.user.delete({ where: { id: userId } });
  return res.json({
    ok: true,
    message: `Le compte de ${existing.firstName} ${existing.lastName} a été supprimé.`,
  });
});

router.use(requireModule("admin"));

router.get("/interventions", async (_req, res) => {
  const items = await prisma.interventionType.findMany({ orderBy: { category: "asc" } });
  return res.json(items);
});

router.post("/interventions", async (req, res) => {
  try {
    const body = interventionSchema.parse(req.body);
    const duplicate = await findDuplicateIntervention({
      code: body.code,
      label: body.label,
      category: body.category,
    });
    if (duplicate) {
      return res.status(409).json(
        duplicateErrorResponse(
          "intervention",
          "Une intervention avec ce code ou ce libellé existe déjà.",
          {
            code: duplicate.code,
            label: duplicate.label,
            category: duplicate.category,
            totalCostFcfa: duplicate.totalCostFcfa,
          },
        ),
      );
    }
    const item = await prisma.interventionType.create({ data: body });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.put("/interventions/:id", async (req, res) => {
  try {
    const body = interventionSchema.partial().parse(req.body);
    const item = await prisma.interventionType.update({
      where: { id: req.params.id },
      data: body,
    });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.get("/products", async (_req, res) => {
  const items = await prisma.product.findMany({ orderBy: { name: "asc" } });
  return res.json(items);
});

router.post("/products", async (req, res) => {
  try {
    const body = productSchema.parse(req.body);
    const duplicate = await findDuplicateProduct({ sku: body.sku, name: body.name });
    if (duplicate) {
      return res.status(409).json(
        duplicateErrorResponse(
          "product",
          "Un produit avec ce SKU ou ce nom existe déjà.",
          { sku: duplicate.sku, name: duplicate.name, unitPriceFcfa: duplicate.unitPriceFcfa },
        ),
      );
    }
    const item = await prisma.product.create({ data: body });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.put("/products/:id", async (req, res) => {
  try {
    const body = productSchema.partial().parse(req.body);
    const item = await prisma.product.update({ where: { id: req.params.id }, data: body });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.get("/rooms", async (_req, res) => {
  const items = await prisma.room.findMany({
    orderBy: { name: "asc" },
  });
  return res.json(items);
});

router.post("/rooms", async (req, res) => {
  try {
    const body = roomSchema.parse(req.body);
    const duplicate = await findDuplicateRoomByName(body.name);
    if (duplicate) {
      return res.status(409).json(
        duplicateErrorResponse(
          "room",
          "Une salle avec ce nom existe déjà.",
          { name: duplicate.name, type: duplicate.type, dailyRateFcfa: duplicate.dailyRateFcfa },
        ),
      );
    }
    const item = await prisma.room.create({ data: body });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.put("/rooms/:id", async (req, res) => {
  try {
    const body = roomSchema.partial().parse(req.body);
    const item = await prisma.room.update({ where: { id: req.params.id }, data: body });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

const adminExpenseSchema = z.object({
  businessDate: z.string().min(8),
  amountFcfa: z.number().int().positive(),
  label: z.string().min(2),
  category: z.nativeEnum(ClinicExpenseCategory).optional(),
  comment: z.string().optional(),
});

function serializeAdminExpense(row: {
  id: string;
  businessDate: Date;
  amountFcfa: number;
  label: string;
  category: ClinicExpenseCategory;
  status: ClinicExpenseStatus;
  comment: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    date: row.businessDate.toISOString().slice(0, 10),
    businessDate: formatBusinessDate(row.businessDate),
    amountFcfa: row.amountFcfa,
    label: row.label,
    description: row.label,
    category: EXPENSE_CATEGORY_LABELS[row.category],
    status: row.status,
    statusLabel: EXPENSE_STATUS_LABELS[row.status],
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}

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
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return res.json(rows.map(serializeAdminExpense));
});

router.post("/expenses", async (req, res) => {
  const user = req.user!;
  try {
    const body = adminExpenseSchema.parse(req.body);
    const businessDate = parseBusinessDate(body.businessDate);
    const row = await prisma.clinicExpense.create({
      data: {
        businessDate,
        amountFcfa: body.amountFcfa,
        label: body.label.trim(),
        category: body.category ?? ClinicExpenseCategory.AUTRE,
        comment: body.comment?.trim() || null,
        status: ClinicExpenseStatus.PENDING,
        paidById: user.id,
        recordedById: user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "CREATE",
        entity: "ClinicExpense",
        entityId: row.id,
        metadata: { label: row.label, amountFcfa: row.amountFcfa },
      },
    });

    return res.status(201).json(serializeAdminExpense(row));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    return res.status(400).json({ error: "Enregistrement impossible" });
  }
});

router.patch("/expenses/:id/validate", async (req, res) => {
  const user = req.user!;
  const row = await prisma.clinicExpense.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });
  if (row.status !== ClinicExpenseStatus.PENDING) {
    return res.status(409).json({ error: "Cette dépense n'est pas en attente de validation." });
  }

  const updated = await prisma.clinicExpense.update({
    where: { id: row.id },
    data: {
      status: ClinicExpenseStatus.VALIDATED,
      validatedById: user.id,
      validatedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "VALIDATE",
      entity: "ClinicExpense",
      entityId: updated.id,
      metadata: { label: updated.label, amountFcfa: updated.amountFcfa },
    },
  });

  return res.json(serializeAdminExpense(updated));
});

router.patch("/expenses/:id/reject", async (req, res) => {
  const user = req.user!;
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 3) {
    return res.status(400).json({ error: "Une justification est requise (3 caractères minimum)." });
  }

  const row = await prisma.clinicExpense.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });
  if (row.status !== ClinicExpenseStatus.PENDING) {
    return res.status(409).json({ error: "Cette dépense n'est pas en attente de validation." });
  }

  const updated = await prisma.clinicExpense.update({
    where: { id: row.id },
    data: {
      status: ClinicExpenseStatus.REJECTED,
      rejectionReason: reason,
      validatedById: user.id,
      validatedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "REJECT",
      entity: "ClinicExpense",
      entityId: updated.id,
      metadata: { label: updated.label, amountFcfa: updated.amountFcfa, reason },
    },
  });

  return res.json(serializeAdminExpense(updated));
});

router.get("/payroll/history", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const rows = await prisma.employeePayroll.findMany({
    where: { status: PayrollStatus.PAID },
    include: employeePayrollInclude,
    orderBy: [{ paidAt: "desc" }],
    take: limit,
  });

  return res.json({
    rows: rows.map((row) => ({
      ...serializePayrollRow(row),
      paidAt: row.paidAt?.toISOString() ?? null,
    })),
  });
});

router.get("/payroll", async (req, res) => {
  const { year, month } = currentPayrollPeriod();
  const queryYear = Number(req.query.year);
  const queryMonth = Number(req.query.month);
  const targetYear = Number.isFinite(queryYear) ? queryYear : year;
  const targetMonth = Number.isFinite(queryMonth) ? queryMonth : month;

  await ensurePayrollForMonth(targetYear, targetMonth);

  const rows = await prisma.employeePayroll.findMany({
    where: { year: targetYear, month: targetMonth },
    include: employeePayrollInclude,
    orderBy: [{ status: "asc" }, { employee: { lastName: "asc" } }],
  });
  const pendingMap = await sumPendingAdvancesByEmployee(rows.map((row) => row.employeeId));

  return res.json({
    year: targetYear,
    month: targetMonth,
    rows: rows.map((row) =>
      serializePayrollRow(row, {
        pendingAdvancesFcfa: pendingMap.get(row.employeeId) ?? 0,
      }),
    ),
  });
});

router.post("/payroll/:id/pay", async (req, res) => {
  const user = req.user!;
  const row = await prisma.employeePayroll.findUnique({
    where: { id: req.params.id },
    include: employeePayrollInclude,
  });
  if (!row) return res.status(404).json({ error: "Fiche de paie introuvable" });
  if (row.status === PayrollStatus.PAID) {
    return res.status(409).json({ error: "Ce salaire est déjà payé." });
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
        paidAt: new Date(),
        paidById: user.id,
        primeFcfa: 0,
        advanceDeductionFcfa,
      },
      include: employeePayrollInclude,
    });
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "PAY",
      entity: "EmployeePayroll",
      entityId: updated.id,
      metadata: {
        employeeName: `${updated.employee.firstName} ${updated.employee.lastName}`.trim(),
        grossFcfa: updated.grossFcfa,
      },
    },
  });

  return res.json(
    serializePayrollRow(updated, { pendingAdvancesFcfa: 0 }),
  );
});

export default router;
