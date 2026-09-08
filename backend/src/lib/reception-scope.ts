import { UserRole, type Prisma } from "@prisma/client";

export type ReceptionScopeUser = { id: string; role: string };

/** Réceptionniste : son id. Direction / gestionnaire / admin : id choisi, sinon tout. */
export function receptionistScopeUserId(
  user: ReceptionScopeUser,
  receptionistId?: string,
): string | null {
  if (user.role === UserRole.RECEPTIONNISTE) return user.id;
  const id = receptionistId?.trim();
  return id || null;
}

export function isReceptionistRole(role: string) {
  return role === UserRole.RECEPTIONNISTE;
}

/** Réceptionniste : uniquement ses dossiers. Direction / gestionnaire / admin : tout, ou un réceptionniste choisi. */
export function receptionistOwnPatientsWhere(
  user: ReceptionScopeUser,
  createdById?: string,
): Prisma.PatientWhereInput {
  const id = receptionistScopeUserId(user, createdById);
  if (!id) return {};
  return { createdById: id };
}

/**
 * Visite du réceptionniste : dossier créé par lui, ou facture émise par lui
 * (re-visite / examens labo sur un dossier déjà ouvert).
 */
export function receptionistOwnVisitsWhere(
  user: ReceptionScopeUser,
  receptionistId?: string,
): Prisma.VisitWhereInput {
  const id = receptionistScopeUserId(user, receptionistId);
  if (!id) return {};
  return {
    OR: [
      { patient: { createdById: id } },
      { invoices: { some: { issuedById: id } } },
    ],
  };
}

export function receptionistOwnConsultationsWhere(
  user: ReceptionScopeUser,
  receptionistId?: string,
): Prisma.ConsultationWhereInput {
  const visitWhere = receptionistOwnVisitsWhere(user, receptionistId);
  if (!Object.keys(visitWhere).length) return {};
  return { visit: visitWhere };
}

export function receptionistOwnReclamationsWhere(
  user: ReceptionScopeUser,
): Prisma.ExamReclamationWhereInput {
  const id = receptionistScopeUserId(user);
  if (!id) return {};
  return {
    OR: [{ createdById: id }, { patient: { createdById: id } }],
  };
}

export function andWhere<T extends object>(base: T, extra: object): T {
  if (!extra || Object.keys(extra).length === 0) return base;
  if (!base || Object.keys(base).length === 0) return extra as T;
  return { AND: [base, extra] } as T;
}

export function receptionistOwnsPatient(
  user: ReceptionScopeUser,
  patient: { createdById?: string | null },
) {
  if (!isReceptionistRole(user.role)) return true;
  return patient.createdById === user.id;
}
