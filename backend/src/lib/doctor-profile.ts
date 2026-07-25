import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

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
