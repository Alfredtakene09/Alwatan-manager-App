import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Compte Direction = ancien rôle comptable (accès comptabilité)
  const direction = await prisma.user.findUnique({
    where: { username: "direction" },
    select: { id: true, employeeId: true, role: true },
  });

  const legacyComptable = await prisma.user.findFirst({
    where: {
      OR: [
        { username: "comptable" },
        { username: { startsWith: "legacy_comptable" } },
      ],
    },
    select: { id: true, employeeId: true, passwordHash: true },
  });

  if (direction) {
    await prisma.user.update({
      where: { id: direction.id },
      data: {
        role: UserRole.COMPTABLE,
        email: "direction@alwatan.local",
        active: true,
        // Conserver le mot de passe de l'ancien comptable s'il existe
        ...(legacyComptable?.passwordHash
          ? { passwordHash: legacyComptable.passwordHash }
          : {}),
      },
    });
    if (direction.employeeId) {
      await prisma.employee.update({
        where: { id: direction.employeeId },
        data: { jobTitle: "Direction" },
      });
    }
    console.log("Compte direction configuré (rôle Direction / COMPTABLE)");
  } else if (legacyComptable) {
    await prisma.user.update({
      where: { id: legacyComptable.id },
      data: {
        username: "direction",
        email: "direction@alwatan.local",
        role: UserRole.COMPTABLE,
        active: true,
      },
    });
    if (legacyComptable.employeeId) {
      await prisma.employee.update({
        where: { id: legacyComptable.employeeId },
        data: { jobTitle: "Direction" },
      });
    }
    console.log("Ancien comptable renommé en direction");
  } else {
    console.log("Aucun compte direction/comptable trouvé");
  }

  // Nettoyer l'ancien compte comptable s'il reste un doublon
  const leftovers = await prisma.user.findMany({
    where: {
      OR: [
        { username: "comptable" },
        { username: { startsWith: "legacy_comptable" } },
      ],
      NOT: { username: "direction" },
    },
    select: { id: true, username: true },
  });
  for (const user of leftovers) {
    try {
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`Doublon supprimé: ${user.username}`);
    } catch {
      await prisma.user.update({
        where: { id: user.id },
        data: { active: false },
      });
      console.log(`Doublon désactivé: ${user.username}`);
    }
  }

  // Référentiel postes
  const oldTitle = await prisma.employeeJobTitle.findUnique({ where: { label: "Comptable" } });
  if (oldTitle) {
    const directionTitle = await prisma.employeeJobTitle.findUnique({
      where: { label: "Direction" },
    });
    if (!directionTitle) {
      await prisma.employeeJobTitle.update({
        where: { label: "Comptable" },
        data: { label: "Direction" },
      });
      console.log("Poste Comptable → Direction");
    } else {
      await prisma.employeeJobTitle.update({
        where: { label: "Comptable" },
        data: { active: false },
      });
    }
  } else {
    await prisma.employeeJobTitle.upsert({
      where: { label: "Direction" },
      update: { active: true },
      create: { label: "Direction", active: true, sortOrder: 3 },
    });
  }

  // Supprimer les comptes soignant
  const soignantUsers = await prisma.user.findMany({
    where: {
      OR: [
        { role: UserRole.SOIGNANT },
        { username: "soignant" },
        { email: { contains: "soignant", mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true },
  });

  for (const user of soignantUsers) {
    try {
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`Compte soignant supprimé: ${user.username}`);
    } catch {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          active: false,
          username: `deleted_soignant_${user.id.slice(0, 8)}`,
          email: `deleted_soignant_${user.id.slice(0, 8)}@alwatan.local`,
        },
      });
      console.log(`Compte soignant désactivé: ${user.username}`);
    }
  }

  if (!soignantUsers.length) {
    console.log("Aucun compte soignant restant");
  }

  const final = await prisma.user.findMany({
    where: {
      OR: [
        { username: "direction" },
        { role: UserRole.COMPTABLE },
        { role: UserRole.SOIGNANT },
      ],
    },
    select: { username: true, email: true, role: true, active: true },
  });
  console.log("État final:", JSON.stringify(final, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
