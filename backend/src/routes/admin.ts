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
  SalaryAdvanceStatus,
} from "@prisma/client";
import { parseShiftSlot } from "../lib/cash-shift.js";
import { prisma } from "../lib/db.js";
import { ensureDefaultClinicServices } from "../lib/clinic-services-seed.js";
import { listRecordedDiagnoses } from "../lib/recorded-diagnoses.js";
import { resolveEmployeeClinicServiceLink } from "../lib/clinic-service-exam.js";
import {
  getClinicServiceWithDoctors,
  listAssignableClinicDoctors,
  listClinicServicesWithDoctors,
  syncClinicServiceDoctors,
  syncEmployeeClinicServices,
} from "../lib/clinic-service-doctors.js";
import { USER_ROLES, canAssignUserRole, canViewEmployeeCompensation, type AppUserRole } from "../lib/roles.js";
import { newPasswordSchema } from "../lib/password-policy.js";
import { employeeCompensationData } from "../lib/doctor-compensation.js";
import { recalculateAfterEmployeeFicheChangeSafe } from "../lib/recalculate-employee-compensation.js";
import {
  deleteOrDeactivateEmployee,
  doctorAvailabilitySlotsSchema,
  normalizeAvailabilitySlots,
  normalizeSpecialty,
  resolveEmployeeIsMedecin,
} from "../lib/doctor-profile.js";
import {
  employeePhotoUpload,
  multerPhotoError,
  saveEmployeePhoto,
  sendEmployeePhoto,
} from "../lib/employee-photo.js";
import { employeeSelect, serializeEmployee, redactEmployeeCompensation, isHiddenPlatformAdminEmployee, hiddenPlatformAdminEmployeeWhere } from "../lib/employee.js";
import {
  countEmployeesForJobTitle,
  serializeJobTitlesWithUsage,
  syncEmployeeJobTitles,
} from "../lib/employee-job-titles-sync.js";
import { countUserRelatedData, userDeletionBlockedMessage } from "../lib/user-deletion.js";
import {
  assertMaintainsActiveAdmin,
  canHardDeleteUser,
  countOtherActiveAdmins,
  LAST_ACTIVE_ADMIN_ERROR,
} from "../lib/admin-user-guards.js";
import {
  findDuplicateIntervention,
  findDuplicateProduct,
  findDuplicateRoomByName,
} from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { requireAuth, requireAdmin, requireAdminOrDirection, requireAnyModule, requireModule, requireUiAction } from "../middleware/auth.js";
import { UI_ACTION_IDS, UI_ACTION_TARGET_ROLES, parseHiddenByRole, parseHiddenUiActionList } from "../lib/ui-actions.js";
import { getHiddenByRole, saveHiddenByRole } from "../lib/role-ui-settings.js";
import {
  currentPayrollPeriod,
  ensurePayrollForMonth,
  employeePayrollInclude,
  serializePayrollRow,
} from "../lib/admin-payroll.js";
import {
  deductPendingAdvancesForPayroll,
  salaryAdvanceInclude,
  serializeSalaryAdvance,
  sumPendingAdvancesByEmployee,
} from "../lib/salary-advances.js";
import { applyValidatedOvertimeToPayroll, sumValidatedOvertimeByEmployee } from "../lib/doctor-overtime.js";
import { applyPendingShareClaimsToPayroll } from "../lib/doctor-share-claims.js";
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
  code: z.string().min(2).optional(),
  label: z.string().min(2),
  category: z.nativeEnum(InterventionCategory),
  totalCostFcfa: z.number().int().positive(),
  surgeonPercent: z.number().int().min(1).max(99),
  clinicServiceId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

function generateInterventionCode(label: string) {
  const slug = label
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18);
  return `OP-${slug || "INTERVENTION"}-${Date.now().toString(36).toUpperCase()}`;
}

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

const assignableUserRoleSchema = z.enum(USER_ROLES);

const employeeCompensationSchema = z.object({
  doctorCompensationType: z.nativeEnum(DoctorCompensationType).optional(),
  consultationTotalFcfa: z.number().int().min(0).nullable().optional(),
  consultationQuotaMode: z.nativeEnum(ConsultationQuotaMode).optional(),
  consultationQuotaPercent: z.number().int().min(1).max(100).nullable().optional(),
  consultationQuotaFcfa: z.number().int().min(0).nullable().optional(),
  consultationValidityDays: z.number().int().min(1).max(365).nullable().optional(),
  consultationRenewalPolicy: z.nativeEnum(ConsultationRenewalPolicy).optional(),
  surgeryQuotaPercent: z.number().int().min(1).max(99).nullable().optional(),
  fixedSalaryFcfa: z.number().int().min(0).nullable().optional(),
  overtimeHourlyRateFcfa: z.number().int().min(0).optional().nullable(),
});

function employeeValidationMessage(error: unknown) {
  if (error instanceof Error && error.message === "DOCTOR_SERVICE_REQUIRED") {
    return "Sélectionnez le service clinique du médecin.";
  }
  if (error instanceof Error && error.message === "SERVICE_INVALID") {
    return "Service clinique introuvable ou inactif.";
  }
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
    specialty: z.string().max(120).optional().nullable(),
    availabilitySlots: doctorAvailabilitySlotsSchema,
    clinicServiceId: z.string().min(1).optional().nullable(),
    clinicServiceIds: z.array(z.string().min(1)).optional().nullable(),
    service: z.string().optional().nullable(),
  })
  .merge(employeeCompensationSchema);

const updateEmployeeSchema = createEmployeeSchema.partial();

const cashShiftSlotSchema = z.enum(["MORNING", "EVENING", "NIGHT"]);

/** E-mail optionnel : ignore chaîne vide / espaces (évite l’échec Zod sur ""). */
const optionalEmailSchema = z.preprocess(
  (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
  z.string().trim().email("Adresse e-mail invalide.").optional(),
);

function zodErrorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? fallback;
  }
  return fallback;
}

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "Le nom d'utilisateur doit contenir au moins 2 caractères.")
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Caractères autorisés : lettres, chiffres, . _ -"),
  email: optionalEmailSchema,
  password: newPasswordSchema,
  role: assignableUserRoleSchema,
  employeeId: z.string().min(1, "Sélectionnez un employé à lier au compte."),
  cashShiftSlot: cashShiftSlotSchema.optional().nullable(),
  active: z.boolean().optional(),
  hiddenUiActions: z.array(z.string()).optional(),
});

const booleanFromForm = z.preprocess((value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean());

const updateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "Le nom d'utilisateur doit contenir au moins 2 caractères.")
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Caractères autorisés : lettres, chiffres, . _ -")
    .optional(),
  email: optionalEmailSchema,
  password: newPasswordSchema.optional(),
  role: assignableUserRoleSchema.optional(),
  active: booleanFromForm.optional(),
  employeeId: z.string().min(1).optional(),
  cashShiftSlot: cashShiftSlotSchema.optional().nullable(),
  hiddenUiActions: z.array(z.string()).optional(),
});

const jobTitleSchema = z.object({
  label: z.string().min(2).max(120),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const clinicServiceSchema = z.object({
  name: z.string().min(2).max(120),
  active: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  doctorIds: z.array(z.string().min(1)).optional(),
});

const userSelect = {
  id: true,
  username: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  active: true,
  failedLoginAttempts: true,
  lockedAt: true,
  employeeId: true,
  cashShiftSlot: true,
  hiddenUiActions: true,
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
    failedLoginAttempts: number;
    lockedAt: Date | null;
    employeeId: string;
    cashShiftSlot: ReceptionShiftSlot | null;
    hiddenUiActions?: unknown;
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
    locked: Boolean(user.lockedAt),
    lockedAt: user.lockedAt,
    failedLoginAttempts: user.failedLoginAttempts,
    employeeId: user.employeeId,
    cashShiftSlot: user.cashShiftSlot,
    hiddenUiActions: parseHiddenUiActionList(user.hiddenUiActions),
    employee: user.employee,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    canDelete: meta?.canDelete ?? false,
    relatedDataCount: meta?.relatedDataCount ?? 0,
  };
}

type SerializedUserInput = Parameters<typeof serializeUser>[0];

async function enrichUserForAdmin(user: SerializedUserInput, currentUserId: string) {
  const relatedDataCount = await countUserRelatedData(user.id);
  const canDelete = await canHardDeleteUser(user, currentUserId, relatedDataCount);
  return serializeUser(user, { canDelete, relatedDataCount });
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
  if (role === UserRole.MEDECIN && !resolveEmployeeIsMedecin(employee.isMedecin, employee.jobTitle)) {
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
      ...hiddenPlatformAdminEmployeeWhere,
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: employeeSelect,
  });

  return res.json(
    employees
      .filter((employee) => !isHiddenPlatformAdminEmployee(employee))
      .map((employee) =>
        redactEmployeeCompensation(
          serializeEmployee(employee),
          canViewEmployeeCompensation(req.user!.role),
        ),
      ),
  );
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

const clinicServicesAccess = requireAnyModule("utilisateurs", "gestionnaire", "comptabilite");

router.get("/services/doctors", clinicServicesAccess, async (_req, res) => {
  const doctors = await listAssignableClinicDoctors();
  return res.json(doctors);
});

router.get("/services", clinicServicesAccess, async (req, res) => {
  await ensureDefaultClinicServices(prisma);
  const activeOnly = req.query.activeOnly === "true";
  return res.json(await listClinicServicesWithDoctors(activeOnly));
});

router.get("/diagnoses", clinicServicesAccess, async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  const items = await listRecordedDiagnoses(month);
  return res.json(
    items.map((item) => ({
      label: item.label,
      count: item.count,
      lastAt: item.lastAt.toISOString(),
    })),
  );
});

router.post("/services", clinicServicesAccess, async (req, res) => {
  try {
    const body = clinicServiceSchema.parse(req.body);
    const created = await prisma.clinicService.create({
      data: {
        name: body.name.trim(),
        active: body.active ?? true,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    if (body.doctorIds) {
      await syncClinicServiceDoctors(created.id, body.doctorIds);
    }
    const item = await getClinicServiceWithDoctors(created.id);
    return res.status(201).json(item);
  } catch (error) {
    if (error instanceof Error && error.message === "DOCTORS_INVALID") {
      return res.status(400).json({ error: "Un ou plusieurs médecins sont invalides." });
    }
    return res.status(400).json({ error: "Service invalide ou déjà existant." });
  }
});

router.put("/services/:id", clinicServicesAccess, async (req, res) => {
  try {
    const id = String(req.params.id);
    const body = clinicServiceSchema.partial().parse(req.body);
    const existing = await prisma.clinicService.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Service introuvable." });

    await prisma.clinicService.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        active: body.active,
        sortOrder: body.sortOrder,
      },
    });
    if (body.doctorIds !== undefined) {
      await syncClinicServiceDoctors(id, body.doctorIds);
    }
    const item = await getClinicServiceWithDoctors(id);
    return res.json(item);
  } catch (error) {
    if (error instanceof Error && error.message === "DOCTORS_INVALID") {
      return res.status(400).json({ error: "Un ou plusieurs médecins sont invalides." });
    }
    return res.status(400).json({ error: "Mise à jour impossible — nom invalide ou déjà utilisé." });
  }
});

router.delete("/services/:id", clinicServicesAccess, async (req, res) => {
  const id = String(req.params.id);
  const item = await prisma.clinicService.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Service introuvable." });

  await prisma.employee.updateMany({
    where: { clinicServiceId: id },
    data: { clinicServiceId: null, service: null },
  });
  await prisma.clinicServiceDoctor.deleteMany({ where: { clinicServiceId: id } });
  await prisma.clinicService.delete({ where: { id } });
  return res.json({ ok: true, message: `Le service « ${item.name} » a été supprimé.` });
});

router.post("/employees", requireModule("utilisateurs"), requireUiAction("employees.create"), async (req, res) => {
  try {
    const body = createEmployeeSchema.parse(req.body);
    const jobTitle = body.jobTitle?.trim() || null;
    const isMedecin = resolveEmployeeIsMedecin(body.isMedecin, jobTitle);
    const availabilitySlots = normalizeAvailabilitySlots(body.availabilitySlots, isMedecin);
    const serviceLink = await resolveEmployeeClinicServiceLink({
      isMedecin,
      clinicServiceId: body.clinicServiceId,
      clinicServiceIds: body.clinicServiceIds,
      service: body.service,
    });
    const employee = await prisma.employee.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone?.trim() || null,
        jobTitle,
        service: serviceLink.service,
        clinicServiceId: serviceLink.clinicServiceId,
        isMedecin,
        specialty: normalizeSpecialty(body.specialty, isMedecin),
        ...(availabilitySlots !== undefined ? { availabilitySlots } : {}),
        active: body.active ?? true,
        overtimeHourlyRateFcfa: isMedecin
          ? body.overtimeHourlyRateFcfa ?? null
          : null,
        ...employeeCompensationData(isMedecin, { ...body, jobTitle }),
      },
      select: employeeSelect,
    });
    if (isMedecin && serviceLink.clinicServiceId) {
      await syncEmployeeClinicServices(employee.id, {
        defaultClinicServiceId: serviceLink.clinicServiceId,
        clinicServiceIds: serviceLink.clinicServiceIds,
      });
    }
    const refreshed = await prisma.employee.findUnique({
      where: { id: employee.id },
      select: employeeSelect,
    });
    return res.status(201).json(serializeEmployee(refreshed ?? employee));
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

    const nextJobTitle =
      body.jobTitle === undefined ? existing.jobTitle : body.jobTitle.trim() || null;
    const nextIsMedecin = resolveEmployeeIsMedecin(
      body.isMedecin !== undefined ? body.isMedecin : existing.isMedecin || undefined,
      nextJobTitle,
    );
    if (existing.user?.role === UserRole.MEDECIN && !nextIsMedecin) {
      return res.status(409).json({
        error: "Impossible de retirer le statut médecin : un compte utilisateur médecin y est lié.",
      });
    }

    const compensationInput =
      body.isMedecin !== undefined ||
      body.jobTitle !== undefined ||
      body.doctorCompensationType !== undefined ||
      body.consultationTotalFcfa !== undefined ||
      body.consultationQuotaPercent !== undefined ||
      body.consultationQuotaFcfa !== undefined ||
      body.consultationQuotaMode !== undefined ||
      body.consultationValidityDays !== undefined ||
      body.consultationRenewalPolicy !== undefined ||
      body.surgeryQuotaPercent !== undefined ||
      body.fixedSalaryFcfa !== undefined
        ? employeeCompensationData(
            nextIsMedecin,
            { ...body, jobTitle: nextJobTitle },
            existing,
          )
        : {};

    const availabilitySlots =
      body.availabilitySlots !== undefined ||
      body.isMedecin !== undefined ||
      body.jobTitle !== undefined
        ? normalizeAvailabilitySlots(
            body.availabilitySlots !== undefined
              ? body.availabilitySlots
              : existing.availabilitySlots,
            nextIsMedecin,
          )
        : undefined;

    const shouldUpdateService =
      body.clinicServiceId !== undefined ||
      body.clinicServiceIds !== undefined ||
      body.service !== undefined ||
      body.isMedecin !== undefined ||
      body.jobTitle !== undefined;
    const existingServiceIds =
      (
        await prisma.clinicServiceDoctor.findMany({
          where: { employeeId },
          select: { clinicServiceId: true },
        })
      ).map((link) => link.clinicServiceId) ?? [];
    const serviceLink = shouldUpdateService
      ? await resolveEmployeeClinicServiceLink({
          isMedecin: nextIsMedecin,
          clinicServiceId:
            body.clinicServiceId !== undefined
              ? body.clinicServiceId
              : existing.clinicServiceId,
          clinicServiceIds:
            body.clinicServiceIds !== undefined
              ? body.clinicServiceIds
              : existingServiceIds,
          service: body.service !== undefined ? body.service : existing.service,
        })
      : null;

    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone === undefined ? undefined : body.phone.trim() || null,
        jobTitle: body.jobTitle === undefined ? undefined : nextJobTitle,
        ...(serviceLink
          ? { service: serviceLink.service, clinicServiceId: serviceLink.clinicServiceId }
          : {}),
        isMedecin: nextIsMedecin,
        active: body.active,
        ...(body.specialty !== undefined ||
        body.isMedecin !== undefined ||
        body.jobTitle !== undefined
          ? {
              specialty: normalizeSpecialty(
                body.specialty !== undefined ? body.specialty : existing.specialty,
                nextIsMedecin,
              ),
            }
          : {}),
        ...(availabilitySlots !== undefined ? { availabilitySlots } : {}),
        ...(body.overtimeHourlyRateFcfa !== undefined
          ? {
              overtimeHourlyRateFcfa: nextIsMedecin
                ? body.overtimeHourlyRateFcfa
                : null,
            }
          : !nextIsMedecin
            ? { overtimeHourlyRateFcfa: null }
            : {}),
        ...compensationInput,
      },
      select: employeeSelect,
    });

    if (serviceLink) {
      if (nextIsMedecin && serviceLink.clinicServiceId) {
        await syncEmployeeClinicServices(employeeId, {
          defaultClinicServiceId: serviceLink.clinicServiceId,
          clinicServiceIds: serviceLink.clinicServiceIds,
        });
      } else {
        await syncEmployeeClinicServices(employeeId, {
          defaultClinicServiceId: null,
          clinicServiceIds: [],
        });
      }
    }

    if (body.firstName || body.lastName) {
      await prisma.user.updateMany({
        where: { employeeId },
        data: {
          firstName: employee.firstName,
          lastName: employee.lastName,
        },
      });
    }

    const refreshed = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: employeeSelect,
    });
    const compensationRecalc = await recalculateAfterEmployeeFicheChangeSafe(employeeId);
    return res.json({
      ...serializeEmployee(refreshed ?? employee),
      compensationRecalc,
    });
  } catch (error) {
    return res.status(400).json({ error: employeeValidationMessage(error) });
  }
});

router.post(
  "/employees/:id/photo",
  requireModule("utilisateurs"),
  (req, res, next) => {
    employeePhotoUpload.single("photo")(req, res, (error) => {
      if (error) return multerPhotoError(error, req, res);
      return next();
    });
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucune photo envoyée." });
    const result = await saveEmployeePhoto(String(req.params.id), req.file);
    if ("error" in result) return res.status(404).json({ error: result.error });
    return res.json({ ok: true, photoPath: result.employee.photoPath, hasPhoto: true });
  },
);

router.get("/employees/:id/photo", requireModule("utilisateurs"), async (req, res) => {
  return sendEmployeePhoto(String(req.params.id), res);
});

router.delete("/employees/:id", requireModule("utilisateurs"), async (req, res) => {
  const result = await deleteOrDeactivateEmployee(String(req.params.id));
  if (result.mode === "not_found") {
    return res.status(404).json({ error: "Employé introuvable" });
  }
  if (result.mode === "blocked") {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json({
    ok: true,
    softDeleted: result.mode === "soft",
    message: result.message,
  });
});

router.get("/users", requireModule("user-accounts"), async (req, res) => {
  const role = req.query.role as string | undefined;
  const roleFilter =
    role && (USER_ROLES as readonly string[]).includes(role) ? (role as UserRole) : undefined;

  const users = await prisma.user.findMany({
    where: roleFilter ? { role: roleFilter } : {},
    orderBy: [{ role: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    select: userSelect,
  });

  const currentUserId = req.user!.id;
  const enriched = await Promise.all(users.map((user) => enrichUserForAdmin(user, currentUserId)));

  return res.json(enriched);
});

router.get("/users/:id", requireModule("user-accounts"), async (req, res) => {
  const userId = String(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect,
  });
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  return res.json(await enrichUserForAdmin(user, req.user!.id));
});

router.post("/users", requireModule("user-accounts"), requireUiAction("users.create"), async (req, res) => {
  try {
    const body = createUserSchema.parse(req.body);
    if (!canAssignUserRole(req.user!.role as AppUserRole, body.role)) {
      return res.status(403).json({
        error: "Seul un administrateur peut créer un compte administrateur.",
        code: "ADMIN_ONLY",
      });
    }
    const existingUsername = await prisma.user.findFirst({
      where: { username: { equals: body.username, mode: "insensitive" } },
    });
    if (existingUsername) {
      return res.status(409).json({ error: "Ce nom d'utilisateur est déjà utilisé." });
    }

    const email = body.email?.trim() || `${body.username}@alwatan.local`;
    const existingEmail = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (existingEmail) {
      return res.status(409).json({ error: "Cet e-mail est déjà utilisé." });
    }

    const employeeCheck = await validateEmployeeForUser(body.employeeId, body.role);
    if ("error" in employeeCheck) {
      return res.status(400).json({ error: employeeCheck.error });
    }

    const cashShiftSlot = resolveCashShiftSlotForRole(body.role, body.cashShiftSlot);
    const passwordHash = await bcrypt.hash(body.password, 10);
    const hiddenUiActions = parseHiddenUiActionList(body.hiddenUiActions ?? []);
    const user = await prisma.user.create({
      data: {
        username: body.username,
        email,
        passwordHash,
        firstName: employeeCheck.employee.firstName,
        lastName: employeeCheck.employee.lastName,
        role: body.role,
        active: body.active ?? true,
        employeeId: body.employeeId,
        cashShiftSlot,
        hiddenUiActions,
      },
      select: userSelect,
    });

    return res.status(201).json(await enrichUserForAdmin(user, req.user!.id));
  } catch (error) {
    return res.status(400).json({ error: zodErrorMessage(error, "Données invalides") });
  }
});

router.put("/users/:id", requireModule("user-accounts"), async (req, res) => {
  try {
    const userId = String(req.params.id);
    const body = updateUserSchema.parse(req.body);
    const currentUser = req.user!;

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) return res.status(404).json({ error: "Utilisateur introuvable" });

    if (body.role && !canAssignUserRole(currentUser.role as AppUserRole, body.role)) {
      return res.status(403).json({
        error: "Seul un administrateur peut attribuer le rôle administrateur.",
        code: "ADMIN_ONLY",
      });
    }

    const usernameChanged =
      typeof body.username === "string" &&
      body.username.toLowerCase() !== existing.username.toLowerCase();
    if (usernameChanged) {
      const usernameTaken = await prisma.user.findFirst({
        where: {
          username: { equals: body.username, mode: "insensitive" },
          id: { not: userId },
        },
      });
      if (usernameTaken) {
        return res.status(409).json({ error: "Ce nom d'utilisateur est déjà utilisé." });
      }
    }

    const emailChanged =
      typeof body.email === "string" &&
      body.email.toLowerCase() !== existing.email.toLowerCase();
    if (emailChanged) {
      const emailTaken = await prisma.user.findFirst({
        where: {
          email: { equals: body.email, mode: "insensitive" },
          id: { not: userId },
        },
      });
      if (emailTaken) {
        return res.status(409).json({ error: "Cet e-mail est déjà utilisé." });
      }
    }

    if (body.active === false && userId === currentUser.id) {
      return res.status(409).json({ error: "Vous ne pouvez pas désactiver votre propre compte." });
    }

    const nextRole = body.role ?? existing.role;
    const nextActive = body.active !== undefined ? body.active : existing.active;
    const adminGuard = await assertMaintainsActiveAdmin({
      existing,
      nextRole,
      nextActive,
    });
    if (adminGuard) {
      return res.status(409).json({ error: adminGuard });
    }

    const employeeChanged =
      typeof body.employeeId === "string" && body.employeeId !== existing.employeeId;
    let employeeNames: { firstName: string; lastName: string } | undefined;
    // Ne revalider le lien employé que s'il change — évite le faux « déjà lié » à l'édition.
    if (employeeChanged) {
      const employeeCheck = await validateEmployeeForUser(body.employeeId!, nextRole, userId);
      if ("error" in employeeCheck) {
        return res.status(400).json({ error: employeeCheck.error });
      }
      employeeNames = {
        firstName: employeeCheck.employee.firstName,
        lastName: employeeCheck.employee.lastName,
      };
    } else if (body.role !== undefined && body.role !== existing.role) {
      // Changement de rôle seul : vérifier la compatibilité avec l'employé déjà lié.
      const employeeCheck = await validateEmployeeForUser(existing.employeeId, nextRole, userId);
      if ("error" in employeeCheck) {
        return res.status(400).json({ error: employeeCheck.error });
      }
    }

    const cashShiftSlot =
      body.cashShiftSlot !== undefined || body.role !== undefined
        ? resolveCashShiftSlotForRole(
            nextRole,
            body.cashShiftSlot !== undefined ? body.cashShiftSlot : existing.cashShiftSlot,
          )
        : undefined;

    // Compte verrouillé / reset MDP : seul un ADMIN peut définir le mot de passe.
    if (body.password && currentUser.role !== UserRole.ADMIN) {
      return res.status(403).json({
        error: existing.lockedAt
          ? "Ce compte est verrouillé. Seul un administrateur peut réinitialiser le mot de passe et le déverrouiller."
          : "Seul un administrateur peut définir ou réinitialiser le mot de passe d'un compte.",
        code: existing.lockedAt ? "ADMIN_UNLOCK_REQUIRED" : "ADMIN_ONLY",
      });
    }

    const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : undefined;
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(usernameChanged || (body.username && body.username !== existing.username)
          ? { username: body.username }
          : {}),
        ...(emailChanged ? { email: body.email } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(employeeChanged ? { employeeId: body.employeeId } : {}),
        ...(cashShiftSlot !== undefined ? { cashShiftSlot } : {}),
        ...(employeeNames ?? {}),
        ...(body.hiddenUiActions !== undefined
          ? { hiddenUiActions: parseHiddenUiActionList(body.hiddenUiActions) }
          : {}),
        ...(passwordHash
          ? {
              passwordHash,
              failedLoginAttempts: 0,
              lockedAt: null,
              // Invalide toute session en cours après reset MDP admin
              sessionTokenId: null,
              lastActivityAt: null,
            }
          : {}),
      },
      select: userSelect,
    });

    return res.json(await enrichUserForAdmin(user, currentUser.id));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
      const fields = Array.isArray(target) ? target.join(",") : String(target ?? "");
      if (fields.includes("email")) {
        return res.status(409).json({ error: "Cet e-mail est déjà utilisé." });
      }
      if (fields.includes("username")) {
        return res.status(409).json({ error: "Ce nom d'utilisateur est déjà utilisé." });
      }
      if (fields.includes("employeeId")) {
        return res.status(409).json({ error: "Cet employé est déjà lié à un compte utilisateur." });
      }
      return res.status(409).json({ error: "Une valeur unique est déjà utilisée par un autre compte." });
    }
    return res.status(400).json({ error: zodErrorMessage(error, "Mise à jour impossible") });
  }
});

const unlockUserSchema = z.object({
  newPassword: newPasswordSchema,
});

/** Déverrouille un compte et impose un nouveau MDP — réservé à ADMIN. */
router.post(
  "/users/:id/unlock",
  requireModule("user-accounts"),
  requireAdmin,
  async (req, res) => {
    try {
      const userId = String(req.params.id);
      const body = unlockUserSchema.parse(req.body);
      const existing = await prisma.user.findUnique({ where: { id: userId } });
      if (!existing) return res.status(404).json({ error: "Utilisateur introuvable" });

      const passwordHash = await bcrypt.hash(body.newPassword, 10);
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedAt: null,
          sessionTokenId: null,
          lastActivityAt: null,
          active: true,
        },
        select: userSelect,
      });

      return res.json({
        ...(await enrichUserForAdmin(user, req.user!.id)),
        message: "Compte déverrouillé. L'utilisateur peut se reconnecter avec le nouveau mot de passe.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.issues[0]?.message ?? "Données invalides." });
      }
      return res.status(400).json({ error: "Déverrouillage impossible." });
    }
  },
);

router.delete("/users/:id", requireModule("user-accounts"), async (req, res) => {
  const userId = String(req.params.id);
  const currentUser = req.user!;

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) return res.status(404).json({ error: "Utilisateur introuvable" });
  if (existing.role === UserRole.ADMIN && currentUser.role !== UserRole.ADMIN) {
    return res.status(403).json({
      error: "Seul un administrateur peut supprimer un compte administrateur.",
      code: "ADMIN_ONLY",
    });
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

  if (existing.role === UserRole.ADMIN && existing.active) {
    const others = await countOtherActiveAdmins(existing.id);
    if (others === 0) {
      return res.status(409).json({ error: LAST_ACTIVE_ADMIN_ERROR });
    }
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
    const code = body.code?.trim() || generateInterventionCode(body.label);
    const duplicate = await findDuplicateIntervention({
      code,
      label: body.label,
      category: body.category,
    });
    if (duplicate) {
      return res.status(409).json(
        duplicateErrorResponse(
          "intervention",
          "Une intervention avec ce libellé existe déjà.",
          {
            code: duplicate.code,
            label: duplicate.label,
            category: duplicate.category,
            totalCostFcfa: duplicate.totalCostFcfa,
          },
        ),
      );
    }
    const item = await prisma.interventionType.create({
      data: {
        label: body.label,
        category: body.category,
        totalCostFcfa: body.totalCostFcfa,
        surgeonPercent: body.surgeonPercent,
        clinicServiceId: body.clinicServiceId ?? null,
        active: body.active ?? true,
        code,
      },
    });
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
  status: z.nativeEnum(ClinicExpenseStatus).optional(),
  comment: z.string().optional(),
  rejectionReason: z.string().optional(),
});

const salaryAdvanceSchema = z.object({
  employeeId: z.string().min(1),
  amountFcfa: z.coerce.number().int().positive(),
  installmentFcfa: z
    .union([z.coerce.number().int().positive(), z.null(), z.literal("")])
    .optional()
    .transform((value) => (value === "" || value == null ? null : value)),
  businessDate: z.string().min(1),
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
  rejectionReason: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    date: row.businessDate.toISOString().slice(0, 10),
    businessDate: formatBusinessDate(row.businessDate),
    categoryCode: row.category,
    amountFcfa: row.amountFcfa,
    label: row.label,
    description: row.label,
    category: EXPENSE_CATEGORY_LABELS[row.category],
    status: row.status,
    statusLabel: EXPENSE_STATUS_LABELS[row.status],
    comment: row.comment,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/expenses", async (req, res) => {
  const fromIso = typeof req.query.from === "string" ? req.query.from : "";
  const toIso = typeof req.query.to === "string" ? req.query.to : "";

  let where: { businessDate?: { gte: Date; lt: Date }; status?: ClinicExpenseStatus } = {};

  if (/^\d{4}-\d{2}-\d{2}$/.test(fromIso) && /^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
    const fromDate = parseBusinessDate(fromIso);
    const toDate = parseBusinessDate(toIso);
    if (fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({ error: "La date de début doit précéder la date de fin." });
    }
    const endExclusive = new Date(toDate);
    endExclusive.setDate(endExclusive.getDate() + 1);
    where = { businessDate: { gte: fromDate, lt: endExclusive } };
  } else {
    const filter = typeof req.query.filter === "string" ? req.query.filter : "all";
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    where =
      filter === "pending"
        ? { status: ClinicExpenseStatus.PENDING }
        : filter === "month"
          ? { businessDate: { gte: monthStart, lt: monthEnd } }
          : {};
  }

  const rows = await prisma.clinicExpense.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return res.json(rows.map(serializeAdminExpense));
});

router.post("/expenses", requireUiAction("comptabilite.depenses"), async (req, res) => {
  const user = req.user!;
  try {
    const body = adminExpenseSchema.parse(req.body);
    const businessDate = parseBusinessDate(body.businessDate);
    const status = body.status ?? ClinicExpenseStatus.VALIDATED;
    const rejectionReason =
      status === ClinicExpenseStatus.REJECTED ? body.rejectionReason?.trim() || "Rejet manuel" : null;
    const row = await prisma.clinicExpense.create({
      data: {
        businessDate,
        amountFcfa: body.amountFcfa,
        label: body.label.trim(),
        category: body.category ?? ClinicExpenseCategory.AUTRE,
        comment: body.comment?.trim() || null,
        status,
        rejectionReason,
        paidById: user.id,
        recordedById: user.id,
        validatedById: status !== ClinicExpenseStatus.PENDING ? user.id : null,
        validatedAt: status !== ClinicExpenseStatus.PENDING ? new Date() : null,
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

router.put("/expenses/:id", requireUiAction("comptabilite.depenses"), async (req, res) => {
  const user = req.user!;
  try {
    const body = adminExpenseSchema.parse(req.body);
    const existing = await prisma.clinicExpense.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Dépense introuvable" });
    const businessDate = parseBusinessDate(body.businessDate);
    const status = body.status ?? existing.status;
    const rejectionReason =
      status === ClinicExpenseStatus.REJECTED ? body.rejectionReason?.trim() || "Rejet manuel" : null;

    const updated = await prisma.clinicExpense.update({
      where: { id: existing.id },
      data: {
        businessDate,
        amountFcfa: body.amountFcfa,
        label: body.label.trim(),
        category: body.category ?? existing.category,
        comment: body.comment?.trim() || null,
        status,
        rejectionReason,
        validatedById: status !== ClinicExpenseStatus.PENDING ? user.id : null,
        validatedAt: status !== ClinicExpenseStatus.PENDING ? new Date() : null,
      },
    });
    return res.json(serializeAdminExpense(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/expenses/:id", requireUiAction("comptabilite.depenses"), async (req, res) => {
  const row = await prisma.clinicExpense.findUnique({ where: { id: String(req.params.id) } });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });
  await prisma.clinicExpense.delete({ where: { id: row.id } });
  return res.status(204).send();
});

router.patch("/expenses/:id/validate", requireUiAction("comptabilite.depenses"), async (req, res) => {
  const user = req.user!;
  const row = await prisma.clinicExpense.findUnique({ where: { id: String(req.params.id) } });
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

router.patch("/expenses/:id/reject", requireUiAction("comptabilite.depenses"), async (req, res) => {
  const user = req.user!;
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 3) {
    return res.status(400).json({ error: "Une justification est requise (3 caractères minimum)." });
  }

  const row = await prisma.clinicExpense.findUnique({ where: { id: String(req.params.id) } });
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
  if (!canViewEmployeeCompensation(req.user!.role)) {
    return res.status(403).json({ error: "Accès aux salaires non autorisé." });
  }
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
  if (!canViewEmployeeCompensation(req.user!.role)) {
    return res.status(403).json({ error: "Accès aux salaires non autorisé." });
  }
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
  const employeeIds = rows.map((row) => row.employeeId);
  const [pendingMap, overtimeMap] = await Promise.all([
    sumPendingAdvancesByEmployee(employeeIds),
    sumValidatedOvertimeByEmployee(employeeIds, targetYear, targetMonth),
  ]);

  return res.json({
    year: targetYear,
    month: targetMonth,
    rows: rows.map((row) =>
      serializePayrollRow(row, {
        pendingAdvancesFcfa: pendingMap.get(row.employeeId) ?? 0,
        pendingOvertimeFcfa: overtimeMap.get(row.employeeId) ?? 0,
      }),
    ),
  });
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
  try {
    const body = salaryAdvanceSchema.parse(req.body);
    if (body.installmentFcfa != null && body.installmentFcfa > body.amountFcfa) {
      return res.status(400).json({
        error: "La tranche mensuelle ne peut pas dépasser le montant total de l'avance.",
      });
    }
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
        remainingFcfa: body.amountFcfa,
        installmentFcfa: body.installmentFcfa ?? null,
        businessDate: parseBusinessDate(body.businessDate),
        comment: body.comment?.trim() || null,
        recordedById: user.id,
      },
      include: salaryAdvanceInclude,
    });
    return res.status(201).json(serializeSalaryAdvance(row));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides" });
    }
    throw error;
  }
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

router.delete("/salary-advances/:id", async (req, res) => {
  const row = await prisma.salaryAdvance.findUnique({
    where: { id: req.params.id },
  });
  if (!row) return res.status(404).json({ error: "Avance introuvable" });
  if (row.status === SalaryAdvanceStatus.PENDING) {
    return res.status(409).json({
      error: "Annulez d'abord l'avance en attente avant de la supprimer.",
    });
  }

  await prisma.salaryAdvance.delete({ where: { id: row.id } });
  return res.status(204).send();
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
    const paidAt = new Date();
    const overtimePrimeFcfa = await applyValidatedOvertimeToPayroll(tx, {
      employeeId: row.employeeId,
      year: row.year,
      month: row.month,
      paidById: user.id,
      paidAt,
    });
    const sharePrimeFcfa = await applyPendingShareClaimsToPayroll(tx, {
      employeeId: row.employeeId,
      year: row.year,
      month: row.month,
      paidById: user.id,
      paidAt,
    });
    const primeFcfa = overtimePrimeFcfa + sharePrimeFcfa;
    return tx.employeePayroll.update({
      where: { id: row.id },
      data: {
        status: PayrollStatus.PAID,
        paidAt,
        paidById: user.id,
        primeFcfa,
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
        primeFcfa: updated.primeFcfa,
      },
    },
  });

  return res.json(
    serializePayrollRow(updated, { pendingAdvancesFcfa: 0 }),
  );
});

const uiPermissionsBodySchema = z.object({
  hiddenByRole: z.record(z.string(), z.array(z.string())).default({}),
});

router.get("/ui-permissions", requireAdminOrDirection, async (_req, res) => {
  const hiddenByRole = await getHiddenByRole();
  return res.json({
    hiddenByRole,
    targetRoles: UI_ACTION_TARGET_ROLES,
    actionIds: UI_ACTION_IDS,
  });
});

router.put("/ui-permissions", requireAdminOrDirection, async (req, res) => {
  const parsed = uiPermissionsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Données invalides.", detail: parsed.error.flatten() });
  }
  const hiddenByRole = await saveHiddenByRole(parseHiddenByRole(parsed.data.hiddenByRole), req.user?.id);
  return res.json({ hiddenByRole });
});

export default router;
