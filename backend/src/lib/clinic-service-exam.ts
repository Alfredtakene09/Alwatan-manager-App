import type { Prisma } from "@prisma/client";
import { ExamCatalogKind } from "@prisma/client";
import { prisma } from "./db.js";

/** Services dont les examens restent visibles pour tous les médecins. */
export const GLOBAL_EXAM_SERVICE_NAMES = ["Laboratoire", "Hospitalisation"] as const;

export type ClinicServiceRef = {
  id: string;
  name: string;
};

export async function resolveClinicServiceById(
  clinicServiceId: string | null | undefined,
): Promise<ClinicServiceRef | null> {
  const id = clinicServiceId?.trim();
  if (!id) return null;
  return prisma.clinicService.findFirst({
    where: { id, active: true },
    select: { id: true, name: true },
  });
}

/**
 * Résout le service clinique par défaut d'un employé.
 * Pour un médecin, clinicServiceId (défaut) est obligatoire.
 * clinicServiceIds = services additionnels (le défaut y est toujours inclus).
 */
export async function resolveEmployeeClinicServiceLink(input: {
  isMedecin: boolean;
  clinicServiceId?: string | null;
  clinicServiceIds?: string[] | null;
  service?: string | null;
}): Promise<{
  clinicServiceId: string | null;
  service: string | null;
  clinicServiceIds: string[];
}> {
  if (input.isMedecin) {
    const defaultService = await resolveClinicServiceById(input.clinicServiceId);
    if (!defaultService) {
      throw new Error("DOCTOR_SERVICE_REQUIRED");
    }
    const extraIds = (input.clinicServiceIds ?? [])
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id));
    const allIds = [...new Set([defaultService.id, ...extraIds])];
    if (allIds.length > 1) {
      const services = await prisma.clinicService.findMany({
        where: { id: { in: allIds }, active: true },
        select: { id: true },
      });
      if (services.length !== allIds.length) {
        throw new Error("SERVICE_INVALID");
      }
    }
    return {
      clinicServiceId: defaultService.id,
      service: defaultService.name,
      clinicServiceIds: allIds,
    };
  }

  if (input.clinicServiceId !== undefined && input.clinicServiceId !== null && input.clinicServiceId.trim()) {
    const service = await resolveClinicServiceById(input.clinicServiceId);
    if (!service) throw new Error("SERVICE_INVALID");
    return { clinicServiceId: service.id, service: service.name, clinicServiceIds: [] };
  }

  const freeText = input.service?.trim() || null;
  return { clinicServiceId: null, service: freeText, clinicServiceIds: [] };
}

/** Filtre catalogue : service du médecin + Laboratoire + Hospitalisation (+ non liés). */
export function examCatalogVisibleForServiceWhere(
  clinicServiceId: string | null | undefined,
): Prisma.ExamCatalogItemWhereInput {
  const serviceId = clinicServiceId?.trim() || null;
  return {
    OR: [
      ...(serviceId ? [{ clinicServiceId: serviceId }] : []),
      { clinicService: { name: { in: [...GLOBAL_EXAM_SERVICE_NAMES] } } },
      { clinicServiceId: null },
    ],
  };
}

export async function resolveDoctorClinicServiceId(
  doctorUserId: string | null | undefined,
): Promise<string | null> {
  const service = await resolveDoctorClinicService(doctorUserId);
  return service?.id ?? null;
}

export async function resolveDoctorClinicService(
  doctorUserId: string | null | undefined,
): Promise<ClinicServiceRef | null> {
  const id = doctorUserId?.trim();
  if (!id) return null;
  const doctor = await prisma.user.findFirst({
    where: { id },
    select: {
      employee: {
        select: {
          clinicServiceId: true,
          clinicService: { select: { id: true, name: true, active: true } },
        },
      },
    },
  });
  const linked = doctor?.employee?.clinicService;
  if (!linked?.active) return null;
  return { id: linked.id, name: linked.name };
}

/** Kind de nomenclature suggéré d'après le nom du service clinique. */
export function suggestExamCatalogKindFromServiceName(serviceName: string): ExamCatalogKind {
  const name = serviceName.trim().toLowerCase();
  if (name.includes("odonto") || name.includes("dent")) return ExamCatalogKind.ODONTO;
  if (name.includes("radio") || name.includes("imagerie")) return ExamCatalogKind.RADIO;
  if (
    name.includes("echo") ||
    name.includes("échographie") ||
    name.includes("echographie") ||
    name.includes("cardio")
  ) {
    return ExamCatalogKind.ECHO;
  }
  // Ophtalmologie et autres spécialités : nomenclature dédiée hors Odonto/Radio/Écho.
  return ExamCatalogKind.EXAMEN;
}

export function examCatalogServiceScopeKey(
  clinicServiceId: string | null | undefined,
): string {
  const id = clinicServiceId?.trim();
  return id || "_";
}

/**
 * Services "canoniques" visibles sur les onglets fixes Labo/Radio/Écho/Odonto.
 * Les autres services (ex. Ophtalmologie) n'apparaissent que sur leur onglet service.
 */
export function isCanonicalServiceForExamKind(
  serviceName: string | null | undefined,
  kind: ExamCatalogKind,
): boolean {
  const name = String(serviceName ?? "")
    .trim()
    .toLowerCase();
  if (!name) return false;
  switch (kind) {
    case ExamCatalogKind.EXAMEN:
      return name.includes("laboratoire") || name.includes("labo");
    case ExamCatalogKind.ODONTO:
      return name.includes("odonto") || name.includes("dent");
    case ExamCatalogKind.RADIO:
      return name.includes("radio") || name.includes("imagerie");
    case ExamCatalogKind.ECHO:
      return (
        name.includes("echo") ||
        name.includes("échographie") ||
        name.includes("echographie") ||
        name.includes("cardio")
      );
    default:
      return false;
  }
}

/**
 * Service "spécialisé" (hors Labo/Radio/Écho/Odonto/Hospitalisation) :
 * ses examens apparaissent dans un onglet dédié à la prescription.
 */
export function isSpecialtyClinicServiceName(serviceName: string | null | undefined): boolean {
  const name = String(serviceName ?? "").trim();
  if (!name) return false;
  if (GLOBAL_EXAM_SERVICE_NAMES.some((globalName) => globalName.toLowerCase() === name.toLowerCase())) {
    return false;
  }
  return !(
    isCanonicalServiceForExamKind(name, ExamCatalogKind.EXAMEN) ||
    isCanonicalServiceForExamKind(name, ExamCatalogKind.ODONTO) ||
    isCanonicalServiceForExamKind(name, ExamCatalogKind.RADIO) ||
    isCanonicalServiceForExamKind(name, ExamCatalogKind.ECHO)
  );
}

/** Élément affiché sur un onglet type (sans filtre service actif). */
export function isExamVisibleOnKindTab(item: {
  clinicServiceId?: string | null;
  clinicService?: { name?: string | null } | null;
}, kind: ExamCatalogKind): boolean {
  if (!item.clinicServiceId) return true;
  return isCanonicalServiceForExamKind(item.clinicService?.name, kind);
}

export function examCatalogKindToSlug(kind: ExamCatalogKind): string {
  switch (kind) {
    case ExamCatalogKind.ODONTO:
      return "odonto";
    case ExamCatalogKind.RADIO:
      return "radio";
    case ExamCatalogKind.ECHO:
      return "echo";
    case ExamCatalogKind.EXAMEN:
    default:
      return "examen";
  }
}
