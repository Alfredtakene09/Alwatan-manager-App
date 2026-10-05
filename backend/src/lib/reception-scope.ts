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

/**
 * Dossiers du médecin à la réception : visites qui lui sont assignées,
 * consultations qu’il a faites, ou patients enregistrés dans un de ses services.
 */
export function patientsInDoctorScopeWhere(
  doctorId: string,
  serviceNames: string[],
  clinicServiceIds: string[] = [],
): Prisma.PatientWhereInput {
  const or: Prisma.PatientWhereInput[] = [
    { visits: { some: { assignedDoctorId: doctorId } } },
    { visits: { some: { consultation: { is: { doctorId } } } } },
  ];
  const names = [...new Set(serviceNames.map((name) => name.trim()).filter(Boolean))];
  if (names.length > 0) {
    or.push({ service: { in: names } });
  }
  const serviceIds = [...new Set(clinicServiceIds.filter(Boolean))];
  if (serviceIds.length > 0) {
    or.push({
      visits: { some: { assignedClinicServiceId: { in: serviceIds } } },
    });
  }
  return { OR: or };
}

/**
 * Cumul d'une réception : chaque facture est comptée une seule fois.
 * Elle va à qui l'a émise. Si l'émetteur n'est pas une réception, elle reste
 * sur le réceptionniste qui a enregistré le patient.
 * Ainsi la somme des cumuls séparés égale le cumul du jour.
 */
export function registrationSummaryReceptionistWhere(
  receptionistId: string,
): Prisma.InvoiceWhereInput {
  return {
    OR: [
      { issuedById: receptionistId },
      {
        patient: { createdById: receptionistId },
        issuedBy: { role: { not: UserRole.RECEPTIONNISTE } },
      },
    ],
  };
}

/** Réceptionniste : uniquement ses dossiers. Direction / gestionnaire / admin : tout, ou un réceptionniste choisi. */
export function receptionistOwnPatientsWhere(
  user: ReceptionScopeUser,
  createdById?: string,
): Prisma.PatientWhereInput {
  const id = receptionistScopeUserId(user, createdById);
  if (!id) return {};
  return {
    OR: [
      { createdById: id },
      { invoices: { some: { issuedById: id } } },
    ],
  };
}

/**
 * Visite du réceptionniste : dossier créé par lui, ou facture émise par lui
 * (re-visite / examens labo sur un dossier déjà ouvert).
 *
 * Ne pas appliquer à la file d'encaissement des examens prescrits par un médecin
 * (pédiatre → réception → labo) : cette file est partagée entre toutes les caisses.
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
