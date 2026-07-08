/**
 * Sépare du formulaire « Routine Investigation » les champs :
 * S.Troponin, B. HCG, PSA, ASO Quantitatif
 * vers un nouveau formulaire « Hormones » (+ champ Hormones).
 *
 * Usage : npx tsx scripts/_split-routine-hormones-panel.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ROUTINE_SLUG = "routine";
const HORMONES_SLUG = "hormones";
const HORMONES_LABEL = "Hormones";

/** Clés des champs à retirer de Routine Investigation. */
const FIELD_KEYS_TO_MOVE = ["sTroponin", "bHcg", "psa", "aso"] as const;

/** Définition cible du nouveau formulaire (ordre d'affichage). */
const HORMONES_FIELDS = [
  { key: "sTroponin", label: "S.Troponin" },
  { key: "bHcg", label: "B. HCG" },
  { key: "psa", label: "PSA" },
  { key: "aso", label: "ASO Quantitatif" },
  { key: "hormones", label: "Hormones" },
] as const;

async function main() {
  const routine = await prisma.labPanel.findUnique({
    where: { slug: ROUTINE_SLUG },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });

  if (!routine) {
    console.error(`Formulaire « ${ROUTINE_SLUG} » introuvable.`);
    process.exit(1);
  }

  const existingHormones = await prisma.labPanel.findUnique({
    where: { slug: HORMONES_SLUG },
    include: { fields: true },
  });

  if (existingHormones) {
    console.log(`Le formulaire « ${HORMONES_LABEL} » existe déjà — rien à faire.`);
    return;
  }

  const movedFromRoutine = routine.fields.filter((field) =>
    (FIELD_KEYS_TO_MOVE as readonly string[]).includes(field.key),
  );

  if (!movedFromRoutine.length) {
    console.warn(
      `Aucun des champs à déplacer trouvé dans « ${routine.label} » — migration peut-être déjà appliquée.`,
    );
  }

  const movedByKey = new Map(movedFromRoutine.map((field) => [field.key, field]));

  const routineSortOrder = routine.sortOrder;
  const hormonesSortOrder = routineSortOrder + 1;

  await prisma.$transaction(async (tx) => {
    // Retirer les champs de Routine Investigation
    await tx.labPanelField.deleteMany({
      where: {
        panelId: routine.id,
        key: { in: [...FIELD_KEYS_TO_MOVE] },
      },
    });

    const remainingRoutineFields = await tx.labPanelField.findMany({
      where: { panelId: routine.id },
      orderBy: { sortOrder: "asc" },
    });

    for (let i = 0; i < remainingRoutineFields.length; i += 1) {
      await tx.labPanelField.update({
        where: { id: remainingRoutineFields[i].id },
        data: { sortOrder: i },
      });
    }

    // Décaler les sortOrder des panels suivants pour insérer Hormones après Routine
    await tx.labPanel.updateMany({
      where: { sortOrder: { gt: routineSortOrder } },
      data: { sortOrder: { increment: 1 } },
    });

    // Créer le formulaire Hormones
    await tx.labPanel.create({
      data: {
        slug: HORMONES_SLUG,
        label: HORMONES_LABEL,
        isEntry: true,
        active: true,
        sortOrder: hormonesSortOrder,
        fields: {
          create: HORMONES_FIELDS.map((def, index) => {
            const source = movedByKey.get(def.key);
            return {
              key: def.key,
              label: def.key === "aso" ? def.label : (source?.label ?? def.label),
              section: source?.section ?? null,
              unit: source?.unit ?? null,
              reference: source?.reference ?? null,
              defaultValue: source?.defaultValue ?? null,
              type: source?.type ?? "text",
              sortOrder: index,
            };
          }),
        },
      },
    });
  });

  console.log(`Champs déplacés depuis « ${routine.label} » : ${movedFromRoutine.map((f) => f.label).join(", ") || "(aucun)"}`);
  console.log(`Nouveau formulaire créé : « ${HORMONES_LABEL} » (${HORMONES_SLUG})`);
  console.log(`Champs : ${HORMONES_FIELDS.map((f) => f.label).join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
