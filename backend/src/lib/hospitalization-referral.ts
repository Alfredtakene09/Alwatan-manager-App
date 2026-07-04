import {
  HospitalizationStatus,
  RoomType,
  VisitStatus,
  type Prisma,
} from "@prisma/client";
import {
  EXAM_KIND_SECTION_LABELS,
  EXAMS_PRESCRIBED_PREFIX,
  getUnpaidPrescribedExamKinds,
  parsePrescribedExamsByKind,
} from "./lab-notes.js";

type DbClient = Prisma.TransactionClient | typeof import("./db.js").prisma;

const DEFAULT_SIMPLE_RATE_FCFA = 25_000;

/** Libellé unique prescrit par le médecin — le choix de salle se fait à la réception. */
export const HOSPITALISATION_PRESCRIPTION_LABEL = "Hospitalisation";

export function consultationHasHospitalisationReferral(clinicalNotes: string | null | undefined, needsHospitalization?: boolean) {
  if (needsHospitalization) return true;
  const prescribed = parsePrescribedExamsByKind(clinicalNotes);
  return (prescribed.hospitalisation?.length ?? 0) > 0;
}

export function hospitalisationPrescriptionLabel(clinicalNotes: string | null | undefined) {
  return parsePrescribedExamsByKind(clinicalNotes).hospitalisation?.find(Boolean) ?? null;
}

async function resolveRoomForLabel(db: DbClient, label?: string | null) {
  const trimmed = label?.trim();
  if (trimmed && trimmed !== HOSPITALISATION_PRESCRIPTION_LABEL) {
    const exact = await db.room.findFirst({
      where: { name: trimmed, active: true },
    });
    if (exact) return exact;

    const normalized = trimmed.toUpperCase();
    if (normalized.includes("VIP")) {
      return db.room.findFirst({
        where: { type: RoomType.VIP, active: true },
        orderBy: { dailyRateFcfa: "asc" },
      });
    }
    if (normalized.includes("SIMPLE")) {
      return db.room.findFirst({
        where: { type: RoomType.SIMPLE, active: true },
        orderBy: { dailyRateFcfa: "asc" },
      });
    }
  }

  return db.room.findFirst({
    where: { active: true },
    orderBy: [{ type: "asc" }, { dailyRateFcfa: "asc" }],
  });
}

export async function ensureHospitalizationFromReferral(
  db: DbClient,
  visitId: string,
  label?: string | null,
) {
  const existing = await db.hospitalization.findUnique({ where: { visitId } });
  if (existing) return existing;

  const room = await resolveRoomForLabel(db, label);
  const roomType = room?.type ?? RoomType.SIMPLE;
  const dailyRateFcfa = room?.dailyRateFcfa ?? DEFAULT_SIMPLE_RATE_FCFA;

  const hospitalization = await db.hospitalization.create({
    data: {
      visitId,
      roomType,
      dailyRateFcfa,
      status: HospitalizationStatus.REQUESTED,
    },
  });

  await db.consultation.updateMany({
    where: { visitId },
    data: { needsHospitalization: true },
  });

  await db.visit.updateMany({
    where: { id: visitId },
    data: { status: VisitStatus.NEEDS_HOSPITALIZATION },
  });

  return hospitalization;
}

export async function syncHospitalizationReferralsForConsultations(
  db: DbClient,
  consultations: Array<{
    visitId: string;
    clinicalNotes: string | null;
    needsHospitalization?: boolean;
  }>,
) {
  for (const consultation of consultations) {
    if (
      !consultationHasHospitalisationReferral(
        consultation.clinicalNotes,
        consultation.needsHospitalization,
      )
    ) {
      continue;
    }
    const label = hospitalisationPrescriptionLabel(consultation.clinicalNotes);
    await ensureHospitalizationFromReferral(db, consultation.visitId, label);
  }
}

export async function syncMissingHospitalizationReferrals(
  db: DbClient,
  patientWhere: Prisma.PatientWhereInput,
) {
  const hospPrefix = `${EXAMS_PRESCRIBED_PREFIX} (${EXAM_KIND_SECTION_LABELS.hospitalisation})`;
  const consultations = await db.consultation.findMany({
    where: {
      visit: { patient: patientWhere },
      OR: [{ needsHospitalization: true }, { clinicalNotes: { contains: hospPrefix } }],
    },
    select: {
      visitId: true,
      clinicalNotes: true,
      needsHospitalization: true,
      visit: { select: { hospitalization: { select: { id: true } } } },
    },
  });

  const missing = consultations.filter(
    (consultation) =>
      consultationHasHospitalisationReferral(
        consultation.clinicalNotes,
        consultation.needsHospitalization,
      ) && !consultation.visit.hospitalization,
  );

  await syncHospitalizationReferralsForConsultations(db, missing);
}

/** Patients « En attente de paiement » avec hospitalisation impayée → dossier hosp. */
export async function syncHospitalizationReferralsFromPaymentQueue(
  db: DbClient,
  patientWhere: Prisma.PatientWhereInput,
) {
  const hospPrefix = `${EXAMS_PRESCRIBED_PREFIX} (${EXAM_KIND_SECTION_LABELS.hospitalisation})`;
  const consultations = await db.consultation.findMany({
    where: {
      visit: { patient: patientWhere },
      clinicalNotes: { contains: hospPrefix },
    },
    select: {
      visitId: true,
      clinicalNotes: true,
      needsHospitalization: true,
    },
  });

  const pendingPayment = consultations.filter((consultation) =>
    getUnpaidPrescribedExamKinds(consultation.clinicalNotes).includes("hospitalisation"),
  );

  await syncHospitalizationReferralsForConsultations(db, pendingPayment);
}

export function isHospitalizationPendingAdmission(hospitalization: {
  status: HospitalizationStatus;
  roomId: string | null;
  startDate: Date | null;
}) {
  if (
    hospitalization.status === HospitalizationStatus.DISCHARGED ||
    hospitalization.status === HospitalizationStatus.CANCELLED
  ) {
    return false;
  }
  return !(
    hospitalization.status === HospitalizationStatus.ACTIVE &&
    hospitalization.roomId &&
    hospitalization.startDate
  );
}
