import type { VisitStatus } from "@prisma/client";
import { prisma } from "./db.js";
import {
  flattenPrescribedExams,
  hasLabResults,
  isClinicalConsultationExamLabel,
  parsePharmacyOrdonnanceLines,
  parsePrescribedExamsByKind,
  type PharmacyOrdonnanceLine,
} from "./lab-notes.js";
import { medecinMatchWhere } from "./medecin-queues.js";
import {
  labelForSlug,
  parseLabPanelResults,
} from "./lab-panel-results.js";

export type MedicalHistoryLabPanel = {
  slug: string;
  label: string;
  filledCount: number;
  values: Record<string, string>;
};

export type MedicalHistoryEntry = {
  visitId: string;
  date: string;
  status: VisitStatus;
  doctor: { firstName: string; lastName: string } | null;
  prescribedExams: string[];
  labPanels: MedicalHistoryLabPanel[];
  doctorComment: string | null;
  pharmacyOrdonnance: PharmacyOrdonnanceLine[];
  hasLabResults: boolean;
};

export type MedicalHistoryPrivacyOptions = {
  labValidatedOnly?: boolean;
  /**
   * Admin / direction / gestionnaire : voient toutes les infos cliniques.
   * Sinon seules les infos du médecin prescripteur (viewerDoctorId) sont exposées.
   */
  canViewAllClinicalDetails?: boolean;
  /** Id du médecin connecté (pour restreindre comment + ordonnance). */
  viewerDoctorId?: string | null;
};

function countFilledValues(values: Record<string, string>) {
  return Object.values(values).filter((value) => value?.trim()).length;
}

function buildLabPanels(clinicalNotes: string | null | undefined): MedicalHistoryLabPanel[] {
  const parsed = parseLabPanelResults(clinicalNotes);
  return Object.keys(parsed)
    .map((slug) => ({
      slug,
      label: labelForSlug(slug),
      filledCount: countFilledValues(parsed[slug] ?? {}),
      values: parsed[slug] ?? {},
    }))
    .filter((panel) => panel.filledCount > 0);
}

/** Résultats saisis au labo et marqués validés (préfixe « Résultats laboratoire »). */
export function hasValidatedLabRecord(clinicalNotes: string | null | undefined) {
  if (!hasLabResults(clinicalNotes)) return false;
  return buildLabPanels(clinicalNotes).length > 0;
}

export function buildMedicalHistoryEntry(
  visit: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: VisitStatus;
    consultation: {
      doctorId?: string | null;
      clinicalNotes: string | null;
      doctorComment: string | null;
      completedAt: Date | null;
      updatedAt: Date;
      doctor: { firstName: string; lastName: string } | null;
    } | null;
  },
  options?: MedicalHistoryPrivacyOptions,
): MedicalHistoryEntry | null {
  const consultation = visit.consultation;
  if (!consultation) return null;

  const canSeeClinical =
    !!options?.canViewAllClinicalDetails ||
    (!!options?.viewerDoctorId &&
      !!consultation.doctorId &&
      consultation.doctorId === options.viewerDoctorId);

  const allPrescribedExams = flattenPrescribedExams(
    parsePrescribedExamsByKind(consultation.clinicalNotes),
  );
  const prescribedExams = canSeeClinical
    ? allPrescribedExams
    : allPrescribedExams.filter((label) => !isClinicalConsultationExamLabel(label));

  const labPanels = hasValidatedLabRecord(consultation.clinicalNotes)
    ? buildLabPanels(consultation.clinicalNotes)
    : [];
  const doctorComment = canSeeClinical
    ? consultation.doctorComment?.trim() || null
    : null;
  const pharmacyOrdonnance = canSeeClinical
    ? parsePharmacyOrdonnanceLines(consultation.clinicalNotes)
    : [];
  const hasResults = hasLabResults(consultation.clinicalNotes);

  if (options?.labValidatedOnly && !hasValidatedLabRecord(consultation.clinicalNotes)) {
    return null;
  }

  if (
    !prescribedExams.length &&
    !labPanels.length &&
    !doctorComment &&
    !pharmacyOrdonnance.length
  ) {
    return null;
  }

  const historyDate =
    consultation.completedAt ?? consultation.updatedAt ?? visit.updatedAt ?? visit.createdAt;

  return {
    visitId: visit.id,
    date: historyDate.toISOString(),
    status: visit.status,
    doctor: consultation.doctor,
    prescribedExams,
    labPanels,
    doctorComment,
    pharmacyOrdonnance,
    hasLabResults: hasResults,
  };
}

export async function getPatientMedicalHistory(
  patientId: string,
  options?: {
    doctorScope?: string;
    canViewAllClinicalDetails?: boolean;
    viewerDoctorId?: string | null;
  },
) {
  const doctorId = options?.doctorScope;
  const visits = await prisma.visit.findMany({
    where: {
      patientId,
      ...(doctorId ? medecinMatchWhere(doctorId) : {}),
    },
    include: {
      consultation: {
        include: {
          doctor: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return visits
    .map((visit) =>
      buildMedicalHistoryEntry(visit, {
        labValidatedOnly: false,
        canViewAllClinicalDetails: options?.canViewAllClinicalDetails,
        viewerDoctorId: options?.viewerDoctorId ?? doctorId ?? null,
      }),
    )
    .filter((entry): entry is MedicalHistoryEntry => entry !== null);
}

export async function getMedecinDossierPatients(doctorId: string) {
  const visits = await prisma.visit.findMany({
    where: medecinMatchWhere(doctorId),
    include: {
      patient: {
        select: {
          id: true,
          code: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
      consultation: {
        select: {
          doctorId: true,
          clinicalNotes: true,
          doctorComment: true,
          completedAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const byPatient = new Map<
    string,
    {
      patient: (typeof visits)[number]["patient"];
      lastVisitAt: string;
      labResultsCount: number;
      hasComment: boolean;
    }
  >();

  for (const visit of visits) {
    const entry = buildMedicalHistoryEntry(
      {
        id: visit.id,
        createdAt: visit.createdAt,
        updatedAt: visit.updatedAt,
        status: visit.status,
        consultation: visit.consultation
          ? {
              doctorId: visit.consultation.doctorId,
              clinicalNotes: visit.consultation.clinicalNotes,
              doctorComment: visit.consultation.doctorComment,
              completedAt: visit.consultation.completedAt ?? null,
              updatedAt: visit.consultation.updatedAt,
              doctor: null,
            }
          : null,
      },
      {
        labValidatedOnly: false,
        viewerDoctorId: doctorId,
      },
    );

    const validatedAt = visit.consultation?.updatedAt ?? visit.updatedAt;
    const labResultsCount = entry?.labPanels.length ?? 0;
    const hasComment = Boolean(
      entry?.doctorComment || (entry?.pharmacyOrdonnance?.length ?? 0) > 0,
    );

    const existing = byPatient.get(visit.patientId);

    if (!existing) {
      byPatient.set(visit.patientId, {
        patient: visit.patient,
        lastVisitAt: validatedAt.toISOString(),
        labResultsCount,
        hasComment,
      });
      continue;
    }

    existing.labResultsCount += labResultsCount;
    if (hasComment) existing.hasComment = true;
    if (new Date(validatedAt).getTime() > new Date(existing.lastVisitAt).getTime()) {
      existing.lastVisitAt = validatedAt.toISOString();
    }
  }

  return [...byPatient.values()].sort(
    (a, b) => new Date(b.lastVisitAt).getTime() - new Date(a.lastVisitAt).getTime(),
  );
}

export function isAutoGeneratedLabDocument(fileName: string, mimeType: string) {
  return mimeType === "text/plain" && /^lab-[a-z]+-/.test(fileName);
}
