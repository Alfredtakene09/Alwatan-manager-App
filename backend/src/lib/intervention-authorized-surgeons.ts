import { prisma } from "./db.js";
import { selectableDoctorWhere } from "./doctor-compensation.js";

/** Normalise et valide une liste de chirurgiens (User médecins sélectionnables). */
export async function resolveAuthorizedSurgeonIds(
  rawIds: Array<string | null | undefined> | null | undefined,
  options?: { alwaysInclude?: string | null },
): Promise<string[]> {
  const ids = new Set<string>();
  for (const raw of rawIds ?? []) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id) ids.add(id);
  }
  const always = options?.alwaysInclude?.trim();
  if (always) ids.add(always);

  if (!ids.size) return [];

  const valid = await prisma.user.findMany({
    where: {
      id: { in: [...ids] },
      ...selectableDoctorWhere,
    },
    select: { id: true },
  });

  return valid.map((d) => d.id);
}

export async function syncInterventionAuthorizedSurgeons(
  interventionTypeId: string,
  surgeonUserIds: string[],
) {
  const unique = [...new Set(surgeonUserIds.map((id) => id.trim()).filter(Boolean))];

  await prisma.$transaction(async (tx) => {
    await tx.interventionTypeSurgeon.deleteMany({
      where: {
        interventionTypeId,
        ...(unique.length ? { userId: { notIn: unique } } : {}),
      },
    });

    if (!unique.length) return;

    await tx.interventionTypeSurgeon.createMany({
      data: unique.map((userId) => ({ interventionTypeId, userId })),
      skipDuplicates: true,
    });
  });
}

export const authorizedSurgeonsInclude = {
  authorizedSurgeons: {
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ user: { lastName: "asc" as const } }, { user: { firstName: "asc" as const } }],
  },
} as const;

export function serializeAuthorizedSurgeons(
  rows:
    | Array<{ userId: string; user: { id: string; firstName: string; lastName: string } }>
    | undefined
    | null,
) {
  return (rows ?? []).map((row) => ({
    id: row.user.id,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
  }));
}
