import { z } from "zod";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "./db.js";
import { countOtherActiveAdmins, LAST_ACTIVE_ADMIN_ERROR } from "./admin-user-guards.js";
import { removeStoredEmployeePhoto } from "./employee-photo.js";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const doctorAvailabilitySlotSchema = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string().regex(timeRegex, "Heure de début invalide (HH:mm)."),
    endTime: z.string().regex(timeRegex, "Heure de fin invalide (HH:mm)."),
  })
  .refine((slot) => slot.startTime < slot.endTime, {
    message: "L'heure de fin doit être après l'heure de début.",
  });

export const doctorAvailabilitySlotsSchema = z
  .array(doctorAvailabilitySlotSchema)
  .max(21, "Trop de créneaux (maximum 21).")
  .nullable()
  .optional();

export type DoctorAvailabilitySlot = z.infer<typeof doctorAvailabilitySlotSchema>;

export function parseAvailabilitySlots(value: unknown): DoctorAvailabilitySlot[] {
  if (value == null) return [];
  const parsed = doctorAvailabilitySlotsSchema.safeParse(value);
  if (!parsed.success || !parsed.data) return [];
  return parsed.data;
}

export function normalizeSpecialty(value: string | null | undefined, isMedecin: boolean) {
  if (!isMedecin) return null;
  return value?.trim() || null;
}

/**
 * Infère le profil médecin depuis le libellé de poste
 * (import personnel / fiches créées en « Personnel » par erreur).
 */
function normalizeStaffLabel(value?: string | null): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") ?? ""
  );
}

/** Poste « Assistant chirurgie » — part % sur les opérations. */
export function isSurgeryAssistantJobTitle(jobTitle?: string | null): boolean {
  const normalized = normalizeStaffLabel(jobTitle);
  return normalized.includes("assistant") && normalized.includes("chirurgie");
}

/** Médecin ou employé enregistré comme assistant ou anesthésiste. */
export function isOperationAssistantStaff(profile: {
  jobTitle?: string | null;
  specialty?: string | null;
}): boolean {
  const title = normalizeStaffLabel(profile.jobTitle);
  const specialty = normalizeStaffLabel(profile.specialty);
  if (title.includes("anesth") || specialty.includes("anesth")) return true;
  return /(^|[^a-z])assistant([^a-z]|$)/.test(title);
}

export function inferIsMedecinFromJobTitle(jobTitle?: string | null): boolean {
  const title = jobTitle?.trim().toLowerCase() ?? "";
  if (!title) return false;
  if (
    /assistant|techni|infirm|aide[- ]?soign|laborantin|pharmacien|r[ée]ception|hygien|hygién|securit|sécurit|entretien/.test(
      title,
    )
  ) {
    return false;
  }
  return /m[ée]decin|chirurgien|gyn[ée]colog|genecolog|ophtalmolog|radiolog|anesth[ée]s|p[ée]diatr|cardiolog|dermatolog|psychiatr|neurolog|urolog|rhumatolog|gastro|g[ée]n[ée]raliste|sp[ée]cialiste/.test(
    title,
  );
}

/** Profil médecin explicite ou déduit du poste. */
export function resolveEmployeeIsMedecin(
  explicit: boolean | undefined,
  jobTitle?: string | null,
): boolean {
  if (explicit === true) return true;
  if (explicit === false && !inferIsMedecinFromJobTitle(jobTitle)) return false;
  return Boolean(explicit) || inferIsMedecinFromJobTitle(jobTitle);
}

/** Retourne la valeur Prisma à persister, ou `undefined` si le champ ne doit pas être touché. */
export function normalizeAvailabilitySlots(
  value: unknown,
  isMedecin: boolean,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (!isMedecin) return Prisma.JsonNull;
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  const slots = doctorAvailabilitySlotsSchema.parse(value);
  if (!slots || slots.length === 0) return Prisma.JsonNull;
  return slots as Prisma.InputJsonValue;
}

/** Compte l'activité clinique liée au compte utilisateur du médecin. */
export async function countDoctorClinicalLinks(userId: string) {
  const [consultations, assignedVisits, surgeriesAsSurgeon] = await Promise.all([
    prisma.consultation.count({ where: { doctorId: userId } }),
    prisma.visit.count({ where: { assignedDoctorId: userId } }),
    prisma.surgeryCase.count({ where: { surgeonId: userId } }),
  ]);
  return consultations + assignedVisits + surgeriesAsSurgeon;
}

export type EmployeeDeletionResult =
  | { mode: "not_found" }
  | { mode: "hard"; message: string }
  | { mode: "soft"; message: string; deactivatedUser: boolean }
  | { mode: "blocked"; status: 409; error: string };

/**
 * Soft-delete si médecin avec historique clinique ou compte lié ;
 * hard delete sinon (personnel sans dépendances).
 */
export async function deleteOrDeactivateEmployee(employeeId: string): Promise<EmployeeDeletionResult> {
  const existing = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      user: { select: { id: true, role: true, active: true } },
    },
  });
  if (!existing) return { mode: "not_found" };

  const mustSoftDelete = existing.isMedecin;

  if (mustSoftDelete) {
    await prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { active: false },
      });
      if (existing.user) {
        await tx.user.update({
          where: { id: existing.user.id },
          data: { active: false },
        });
      }
    });
    return {
      mode: "soft",
      deactivatedUser: Boolean(existing.user),
      message: existing.user
        ? `Le médecin « ${existing.firstName} ${existing.lastName} » a été désactivé (historique clinique conservé). Le compte application a aussi été désactivé.`
        : `Le médecin « ${existing.firstName} ${existing.lastName} » a été désactivé.`,
    };
  }

  if (existing.user) {
    return {
      mode: "blocked",
      status: 409,
      error:
        "Impossible de supprimer cet employé : un compte application y est lié. Supprimez d'abord le compte, ou désactivez la fiche.",
    };
  }

  await prisma.employee.delete({ where: { id: employeeId } });
  return {
    mode: "hard",
    message: `L'employé « ${existing.firstName} ${existing.lastName} » a été supprimé.`,
  };
}

const PERSON_DELETE_BLOCKED =
  "Suppression impossible : des opérations, factures ou mouvements de caisse sont encore liés à ce compte.";

class PersonDeleteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonDeleteBlockedError";
  }
}

function isForeignKeyError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

async function clearOptionalUserLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  displayName: string,
) {
  const [asSurgeon, asAnesthesiologist] = await Promise.all([
    tx.interventionType.findMany({
      where: { surgeonId: userId },
      select: { id: true, surgeonName: true },
    }),
    tx.interventionType.findMany({
      where: { anesthesiologistId: userId },
      select: { id: true, anesthesiologistName: true },
    }),
  ]);

  for (const row of asSurgeon) {
    await tx.interventionType.update({
      where: { id: row.id },
      data: {
        surgeonId: null,
        ...(row.surgeonName?.trim() ? {} : { surgeonName: displayName }),
      },
    });
  }
  for (const row of asAnesthesiologist) {
    await tx.interventionType.update({
      where: { id: row.id },
      data: {
        anesthesiologistId: null,
        ...(row.anesthesiologistName?.trim() ? {} : { anesthesiologistName: displayName }),
      },
    });
  }

  await Promise.all([
    tx.patient.updateMany({ where: { treatingDoctorId: userId }, data: { treatingDoctorId: null } }),
    tx.patient.updateMany({ where: { createdById: userId }, data: { createdById: null } }),
    tx.patient.updateMany({ where: { updatedById: userId }, data: { updatedById: null } }),
    tx.visit.updateMany({ where: { assignedDoctorId: userId }, data: { assignedDoctorId: null } }),
    tx.consultation.updateMany({ where: { doctorId: userId }, data: { doctorId: null } }),
    tx.consultation.updateMany({ where: { labApprovedById: userId }, data: { labApprovedById: null } }),
    tx.consultation.updateMany({ where: { labRecordedById: userId }, data: { labRecordedById: null } }),
    tx.surgeryCase.updateMany({ where: { accountantId: userId }, data: { accountantId: null } }),
    tx.surgeryCase.updateMany({ where: { surgeonPaidById: userId }, data: { surgeonPaidById: null } }),
    tx.surgeryCase.updateMany({ where: { assistantPaidById: userId }, data: { assistantPaidById: null } }),
    tx.surgeryCase.updateMany({ where: { clinicPaidById: userId }, data: { clinicPaidById: null } }),
    tx.hospitalization.updateMany({ where: { accountantId: userId }, data: { accountantId: null } }),
    tx.hospitalization.updateMany({ where: { attendingDoctorId: userId }, data: { attendingDoctorId: null } }),
    tx.receptionDayClosure.updateMany({ where: { validatedById: userId }, data: { validatedById: null } }),
    tx.clinicExpense.updateMany({ where: { validatedById: userId }, data: { validatedById: null } }),
    tx.employeePayroll.updateMany({ where: { paidById: userId }, data: { paidById: null } }),
    tx.doctorOvertimeEntry.updateMany({ where: { validatedById: userId }, data: { validatedById: null } }),
    tx.doctorOvertimeEntry.updateMany({ where: { paidById: userId }, data: { paidById: null } }),
    tx.doctorShareClaim.updateMany({ where: { settledById: userId }, data: { settledById: null } }),
    tx.cashChangeTransfer.updateMany({ where: { refundedById: userId }, data: { refundedById: null } }),
    tx.auditLog.updateMany({ where: { userId }, data: { userId: null } }),
    tx.examReclamation.updateMany({ where: { handledById: userId }, data: { handledById: null } }),
    tx.logisticsRequest.updateMany({ where: { handledById: userId }, data: { handledById: null } }),
  ]);

  const foreignShareRequests = await tx.doctorShareClaim.count({
    where: { requestedById: userId, doctorUserId: { not: userId } },
  });
  if (foreignShareRequests > 0) {
    throw new PersonDeleteBlockedError(PERSON_DELETE_BLOCKED);
  }
  await tx.doctorShareClaim.deleteMany({ where: { doctorUserId: userId } });
}

async function hardDeleteLoadedEmployee(
  existing: {
    id: string;
    firstName: string;
    lastName: string;
    photoPath: string | null;
    user: { id: string; role: UserRole; active: boolean } | null;
  },
  actorUserId: string,
): Promise<EmployeeDeletionResult> {
  if (existing.user?.id === actorUserId) {
    return { mode: "blocked", status: 409, error: "Vous ne pouvez pas supprimer votre propre compte." };
  }
  if (existing.user?.role === UserRole.ADMIN && existing.user.active) {
    const others = await countOtherActiveAdmins(existing.user.id);
    if (others === 0) return { mode: "blocked", status: 409, error: LAST_ACTIVE_ADMIN_ERROR };
  }

  const displayName = `${existing.firstName} ${existing.lastName}`.trim();
  try {
    await prisma.$transaction(async (tx) => {
      if (existing.user) {
        await clearOptionalUserLinks(tx, existing.user.id, displayName);
        await tx.user.delete({ where: { id: existing.user.id } });
      }
      await tx.employee.delete({ where: { id: existing.id } });
    });
  } catch (error) {
    if (error instanceof PersonDeleteBlockedError) {
      return { mode: "blocked", status: 409, error: error.message };
    }
    if (isForeignKeyError(error)) {
      return { mode: "blocked", status: 409, error: PERSON_DELETE_BLOCKED };
    }
    throw error;
  }

  removeStoredEmployeePhoto(existing.photoPath);
  return {
    mode: "hard",
    message: `« ${displayName} » a été supprimé de la liste du personnel et son compte a été retiré.`,
  };
}

/** Suppression définitive (admin) : fiche employé + compte, dossiers patients conservés. */
export async function hardDeleteEmployee(
  employeeId: string,
  actorUserId: string,
): Promise<EmployeeDeletionResult> {
  const existing = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { id: true, role: true, active: true } } },
  });
  if (!existing) return { mode: "not_found" };
  return hardDeleteLoadedEmployee(existing, actorUserId);
}

/** Suppression définitive depuis la liste des utilisateurs. */
export async function hardDeleteUserAccount(
  userId: string,
  actorUserId: string,
): Promise<EmployeeDeletionResult> {
  const existing = await prisma.employee.findFirst({
    where: { user: { id: userId } },
    include: { user: { select: { id: true, role: true, active: true } } },
  });
  if (!existing) return { mode: "not_found" };
  return hardDeleteLoadedEmployee(existing, actorUserId);
}
