import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

/** Nom unique affiché partout : les deux spécialités restent lisibles. */
export const ORTHO_TRAUMA_SERVICE_NAME = "Orthopédie & Tromatologie";

const ORTHO_TRAUMA_TOKEN =
  /^(orthopedie|ortopedie|traumatologie|tromatologie|tromotologie)$/;

export function foldClinicServiceName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Orthopédie, Traumatologie et la graphie « Tromatologie », seules ou combinées. */
export function isOrthoTraumaServiceName(label: string | null | undefined): boolean {
  const parts = foldClinicServiceName(label ?? "").split(" ").filter(Boolean);
  return parts.length > 0 && parts.every((part) => ORTHO_TRAUMA_TOKEN.test(part));
}

export function canonicalClinicServiceName(label: string): string {
  const trimmed = label.trim();
  return isOrthoTraumaServiceName(trimmed) ? ORTHO_TRAUMA_SERVICE_NAME : trimmed;
}

async function rewriteStoredServiceLabel(
  tx: Prisma.TransactionClient,
  from: string,
) {
  const match = { equals: from, mode: "insensitive" as const };
  const data = { service: ORTHO_TRAUMA_SERVICE_NAME };
  await tx.patient.updateMany({ where: { service: match }, data });
  await tx.employee.updateMany({ where: { service: match }, data });
  await tx.hospitalization.updateMany({ where: { service: match }, data });
  await tx.logisticsRequest.updateMany({ where: { service: match }, data });
}

async function moveExamCatalogItems(
  tx: Prisma.TransactionClient,
  fromId: string,
  keeperId: string,
) {
  const items = await tx.examCatalogItem.findMany({
    where: { clinicServiceId: fromId },
    select: { id: true, kind: true, code: true },
  });
  for (const item of items) {
    const clash = await tx.examCatalogItem.findFirst({
      where: {
        kind: item.kind,
        code: item.code,
        serviceScopeKey: keeperId,
        NOT: { id: item.id },
      },
      select: { id: true },
    });
    if (clash) {
      await tx.examCatalogItem.update({
        where: { id: item.id },
        data: { active: false, clinicServiceId: null, serviceScopeKey: `merged-${item.id}` },
      });
      continue;
    }
    await tx.examCatalogItem.update({
      where: { id: item.id },
      data: { clinicServiceId: keeperId, serviceScopeKey: keeperId },
    });
  }
}

async function moveExamCatalogTabs(
  tx: Prisma.TransactionClient,
  fromId: string,
  keeperId: string,
) {
  const tabs = await tx.examCatalogServiceTab.findMany({
    where: { clinicServiceId: fromId },
    select: { id: true, kind: true },
  });
  for (const tab of tabs) {
    const clash = await tx.examCatalogServiceTab.findFirst({
      where: { kind: tab.kind, clinicServiceId: keeperId },
      select: { id: true },
    });
    if (clash) {
      await tx.examCatalogServiceTab.delete({ where: { id: tab.id } });
      continue;
    }
    await tx.examCatalogServiceTab.update({
      where: { id: tab.id },
      data: { clinicServiceId: keeperId },
    });
  }
}

async function moveDoctorLinks(
  tx: Prisma.TransactionClient,
  fromId: string,
  keeperId: string,
) {
  const links = await tx.clinicServiceDoctor.findMany({
    where: { clinicServiceId: fromId },
    select: { id: true, employeeId: true, isDefault: true },
  });
  for (const link of links) {
    const existing = await tx.clinicServiceDoctor.findUnique({
      where: {
        employeeId_clinicServiceId: { employeeId: link.employeeId, clinicServiceId: keeperId },
      },
      select: { id: true, isDefault: true },
    });
    if (existing) {
      if (link.isDefault && !existing.isDefault) {
        await tx.clinicServiceDoctor.updateMany({
          where: { employeeId: link.employeeId },
          data: { isDefault: false },
        });
        await tx.clinicServiceDoctor.update({
          where: { id: existing.id },
          data: { isDefault: true },
        });
      }
      await tx.clinicServiceDoctor.delete({ where: { id: link.id } });
      continue;
    }
    await tx.clinicServiceDoctor.update({
      where: { id: link.id },
      data: { clinicServiceId: keeperId },
    });
  }
}

/**
 * Réunit Orthopédie et Tromatologie en un seul service clinique.
 * Les médecins, visites, opérations et libellés enregistrés suivent ce service.
 */
export async function mergeOrthoTraumaClinicServices(): Promise<{
  merged: boolean;
  removed: number;
  renamed: boolean;
}> {
  const services = await prisma.clinicService.findMany({
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const matches = services.filter((service) => isOrthoTraumaServiceName(service.name));
  if (matches.length === 0) return { merged: false, removed: 0, renamed: false };

  const keeper =
    matches.find((service) => service.name === ORTHO_TRAUMA_SERVICE_NAME) ??
    matches.find((service) => foldClinicServiceName(service.name) === foldClinicServiceName(ORTHO_TRAUMA_SERVICE_NAME)) ??
    matches[0];
  const others = matches.filter((service) => service.id !== keeper.id);
  const labels = new Set<string>([
    ...matches.map((service) => service.name),
    "Orthopédie",
    "Orthopedie",
    "ORTHOPEDIE",
    "Ortopedie",
    "Traumatologie",
    "Tromatologie",
    "Tromotologie",
    "traumatologie&Orthopedie",
    "Orthopédie & Traumatologie",
  ]);

  await prisma.$transaction(async (tx) => {
    for (const other of others) {
      await tx.visit.updateMany({
        where: { assignedClinicServiceId: other.id },
        data: { assignedClinicServiceId: keeper.id },
      });
      await tx.interventionType.updateMany({
        where: { clinicServiceId: other.id },
        data: { clinicServiceId: keeper.id },
      });
      await tx.employee.updateMany({
        where: { clinicServiceId: other.id },
        data: { clinicServiceId: keeper.id },
      });
      await moveExamCatalogItems(tx, other.id, keeper.id);
      await moveExamCatalogTabs(tx, other.id, keeper.id);
      await moveDoctorLinks(tx, other.id, keeper.id);
      await tx.clinicService.delete({ where: { id: other.id } });
    }

    if (keeper.name !== ORTHO_TRAUMA_SERVICE_NAME) {
      await tx.clinicService.update({
        where: { id: keeper.id },
        data: { name: ORTHO_TRAUMA_SERVICE_NAME, active: true },
      });
    }

    for (const label of labels) {
      if (foldClinicServiceName(label) === foldClinicServiceName(ORTHO_TRAUMA_SERVICE_NAME) && label === ORTHO_TRAUMA_SERVICE_NAME) {
        continue;
      }
      await rewriteStoredServiceLabel(tx, label);
    }
  });

  return {
    merged: true,
    removed: others.length,
    renamed: keeper.name !== ORTHO_TRAUMA_SERVICE_NAME,
  };
}
