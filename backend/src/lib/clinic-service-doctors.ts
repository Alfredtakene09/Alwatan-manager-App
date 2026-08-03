import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

export const clinicServiceDoctorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  specialty: true,
  active: true,
  clinicServiceId: true,
  user: { select: { id: true, active: true } },
  clinicServiceLinks: {
    select: {
      clinicServiceId: true,
      isDefault: true,
      clinicService: { select: { id: true, name: true, active: true } },
    },
  },
} as const;

export type ClinicServiceDoctorRow = {
  id: string;
  firstName: string;
  lastName: string;
  specialty: string | null;
  active: boolean;
  /** False si la fiche médecin n’a pas encore de compte application actif. */
  hasActiveUser: boolean;
  clinicServiceId?: string | null;
  clinicServiceIds?: string[];
  clinicServices?: { id: string; name: string; isDefault: boolean }[];
};

const serviceWithDoctorsInclude = {
  serviceDoctors: {
    where: {
      // Fiche médecin active suffit pour le rattachement service
      // (le compte utilisateur n’est requis que pour la consultation / réception).
      employee: { isMedecin: true, active: true },
    },
    orderBy: [
      { employee: { lastName: "asc" as const } },
      { employee: { firstName: "asc" as const } },
    ],
    select: {
      isDefault: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          specialty: true,
          active: true,
          clinicServiceId: true,
          user: { select: { id: true, active: true } },
        },
      },
    },
  },
} satisfies Prisma.ClinicServiceInclude;

export type ClinicServiceWithDoctors = Prisma.ClinicServiceGetPayload<{
  include: typeof serviceWithDoctorsInclude;
}>;

export function serializeClinicService(service: ClinicServiceWithDoctors) {
  return {
    id: service.id,
    name: service.name,
    active: service.active,
    sortOrder: service.sortOrder,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    doctors: service.serviceDoctors.map((link) => ({
      id: link.employee.id,
      firstName: link.employee.firstName,
      lastName: link.employee.lastName,
      specialty: link.employee.specialty,
      active: link.employee.active,
      hasActiveUser: Boolean(link.employee.user?.active),
      clinicServiceId: link.employee.clinicServiceId,
      isDefaultForService: link.isDefault,
    })),
  };
}

export async function listClinicServicesWithDoctors(activeOnly: boolean) {
  await backfillClinicServiceDoctorLinks();
  const items = await prisma.clinicService.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: serviceWithDoctorsInclude,
  });
  return items.map(serializeClinicService);
}

export async function getClinicServiceWithDoctors(id: string) {
  const item = await prisma.clinicService.findUnique({
    where: { id },
    include: serviceWithDoctorsInclude,
  });
  return item ? serializeClinicService(item) : null;
}

function serializeAssignableDoctor(
  doctor: {
    id: string;
    firstName: string;
    lastName: string;
    specialty: string | null;
    active: boolean;
    clinicServiceId: string | null;
    user: { id: string; active: boolean } | null;
    clinicServiceLinks: {
      clinicServiceId: string;
      isDefault: boolean;
      clinicService: { id: string; name: string; active: boolean };
    }[];
  },
): ClinicServiceDoctorRow {
  const clinicServices = doctor.clinicServiceLinks
    .filter((link) => link.clinicService.active)
    .map((link) => ({
      id: link.clinicService.id,
      name: link.clinicService.name,
      isDefault: link.isDefault,
    }))
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name, "fr");
    });

  return {
    id: doctor.id,
    firstName: doctor.firstName,
    lastName: doctor.lastName,
    specialty: doctor.specialty,
    active: doctor.active,
    hasActiveUser: Boolean(doctor.user?.active),
    clinicServiceId: doctor.clinicServiceId,
    clinicServiceIds: clinicServices.map((s) => s.id),
    clinicServices,
  };
}

export async function listAssignableClinicDoctors(): Promise<ClinicServiceDoctorRow[]> {
  await backfillClinicServiceDoctorLinks();
  const doctors = await prisma.employee.findMany({
    where: {
      isMedecin: true,
      active: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: clinicServiceDoctorSelect,
  });
  return doctors.map(serializeAssignableDoctor);
}

/**
 * Migre les anciens FK Employee.clinicServiceId vers ClinicServiceDoctor.
 */
export async function backfillClinicServiceDoctorLinks() {
  const orphans = await prisma.employee.findMany({
    where: {
      isMedecin: true,
      clinicServiceId: { not: null },
      clinicServiceLinks: { none: {} },
    },
    select: { id: true, clinicServiceId: true },
  });
  if (!orphans.length) return;

  await prisma.clinicServiceDoctor.createMany({
    data: orphans
      .filter((row): row is { id: string; clinicServiceId: string } => Boolean(row.clinicServiceId))
      .map((row) => ({
        employeeId: row.id,
        clinicServiceId: row.clinicServiceId,
        isDefault: true,
      })),
    skipDuplicates: true,
  });
}

async function refreshEmployeeDefaultService(
  tx: Prisma.TransactionClient,
  employeeId: string,
  preferredDefaultId?: string | null,
) {
  const links = await tx.clinicServiceDoctor.findMany({
    where: { employeeId },
    include: { clinicService: { select: { id: true, name: true, active: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (!links.length) {
    await tx.employee.update({
      where: { id: employeeId },
      data: { clinicServiceId: null, service: null },
    });
    return;
  }

  const preferred =
    (preferredDefaultId
      ? links.find((link) => link.clinicServiceId === preferredDefaultId)
      : null) ??
    links.find((link) => link.isDefault) ??
    links[0];

  await tx.clinicServiceDoctor.updateMany({
    where: { employeeId },
    data: { isDefault: false },
  });
  await tx.clinicServiceDoctor.update({
    where: { id: preferred.id },
    data: { isDefault: true },
  });
  await tx.employee.update({
    where: { id: employeeId },
    data: {
      clinicServiceId: preferred.clinicService.id,
      service: preferred.clinicService.name,
    },
  });
}

/**
 * Remplace tous les services d'un médecin.
 * `defaultClinicServiceId` doit figurer dans `clinicServiceIds`.
 */
export async function syncEmployeeClinicServices(
  employeeId: string,
  input: {
    defaultClinicServiceId: string | null;
    clinicServiceIds?: string[] | null;
  },
) {
  const defaultId = input.defaultClinicServiceId?.trim() || null;
  const extraIds = (input.clinicServiceIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean);
  const allIds = [...new Set([...(defaultId ? [defaultId] : []), ...extraIds])];

  if (!defaultId && allIds.length > 0) {
    throw new Error("DOCTOR_SERVICE_REQUIRED");
  }
  if (defaultId && !allIds.includes(defaultId)) {
    allIds.push(defaultId);
  }
  if (!allIds.length) {
    await prisma.$transaction(async (tx) => {
      await tx.clinicServiceDoctor.deleteMany({ where: { employeeId } });
      await tx.employee.update({
        where: { id: employeeId },
        data: { clinicServiceId: null, service: null },
      });
    });
    return;
  }

  const services = await prisma.clinicService.findMany({
    where: { id: { in: allIds }, active: true },
    select: { id: true, name: true },
  });
  if (services.length !== allIds.length) {
    throw new Error("SERVICE_INVALID");
  }
  if (!defaultId || !services.some((s) => s.id === defaultId)) {
    throw new Error("DOCTOR_SERVICE_REQUIRED");
  }

  await prisma.$transaction(async (tx) => {
    await tx.clinicServiceDoctor.deleteMany({
      where: {
        employeeId,
        clinicServiceId: { notIn: allIds },
      },
    });

    for (const service of services) {
      await tx.clinicServiceDoctor.upsert({
        where: {
          employeeId_clinicServiceId: {
            employeeId,
            clinicServiceId: service.id,
          },
        },
        create: {
          employeeId,
          clinicServiceId: service.id,
          isDefault: service.id === defaultId,
        },
        update: {
          isDefault: service.id === defaultId,
        },
      });
    }

    await refreshEmployeeDefaultService(tx, employeeId, defaultId);
  });
}

/**
 * Rattache les médecins sélectionnés au service (sans les retirer des autres).
 * Les médecins décochés sont seulement détachés de CE service.
 */
export async function syncClinicServiceDoctors(serviceId: string, doctorIds: string[]) {
  const uniqueIds = [...new Set(doctorIds.map((id) => id.trim()).filter(Boolean))];

  const service = await prisma.clinicService.findUnique({
    where: { id: serviceId },
    select: { id: true, name: true },
  });
  if (!service) throw new Error("SERVICE_NOT_FOUND");

  if (uniqueIds.length > 0) {
    const doctors = await prisma.employee.findMany({
      where: {
        id: { in: uniqueIds },
        isMedecin: true,
        active: true,
      },
      select: { id: true, clinicServiceId: true },
    });
    if (doctors.length !== uniqueIds.length) {
      throw new Error("DOCTORS_INVALID");
    }
  }

  await prisma.$transaction(async (tx) => {
    const previousLinks = await tx.clinicServiceDoctor.findMany({
      where: {
        clinicServiceId: serviceId,
        ...(uniqueIds.length ? { employeeId: { notIn: uniqueIds } } : {}),
      },
      select: { employeeId: true, isDefault: true },
    });

    await tx.clinicServiceDoctor.deleteMany({
      where: {
        clinicServiceId: serviceId,
        ...(uniqueIds.length ? { employeeId: { notIn: uniqueIds } } : {}),
      },
    });

    for (const removed of previousLinks) {
      await refreshEmployeeDefaultService(tx, removed.employeeId);
    }

    for (const employeeId of uniqueIds) {
      const existingDefault = await tx.clinicServiceDoctor.findFirst({
        where: { employeeId, isDefault: true },
        select: { id: true },
      });
      await tx.clinicServiceDoctor.upsert({
        where: {
          employeeId_clinicServiceId: {
            employeeId,
            clinicServiceId: serviceId,
          },
        },
        create: {
          employeeId,
          clinicServiceId: serviceId,
          isDefault: !existingDefault,
        },
        update: {},
      });
      if (!existingDefault) {
        await refreshEmployeeDefaultService(tx, employeeId, serviceId);
      }
    }
  });
}
