/**
 * Renommage / fusion globale des catégories pharmacie (ProductCategory).
 *
 * 1. Éditez la table RENAMES ci-dessous (ancien nom exact → nouveau nom).
 * 2. Lancez :
 *      npx tsx scripts/rename-pharmacy-categories.ts
 *    Options :
 *      --dry-run   aperçu sans écriture
 *      --yes       appliquer sans confirmation console
 *      --list      lister les catégories actuelles puis quitter
 *
 * Si le nouveau nom existe déjà : les produits sont réaffectés, puis l’ancienne
 * catégorie est supprimée (fusion).
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { prisma } from "../src/lib/db.js";

// ─── Table à éditer ───────────────────────────────────────────────────────────
/** Ancien nom de catégorie → nouveau nom. Les correspondances vides sont ignorées. */
const RENAMES: Record<string, string> = {
  // Exemples (décommentez / adaptez) :
  // "Comprimé": "Antalgiques",
  // "Sirop": "Pédiatrie",
  // "Analgesique": "Analgésique",
  // "antibiotiques": "Antibiotiques",
};
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const autoYes = args.includes("--yes");
const listOnly = args.includes("--list");

function norm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function key(value: string): string {
  return norm(value).toLocaleLowerCase("fr");
}

type CategoryRow = {
  id: string;
  name: string;
  active: boolean;
  productsCount: number;
};

async function loadCategories(): Promise<CategoryRow[]> {
  const items = await prisma.productCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    active: item.active,
    productsCount: item._count.products,
  }));
}

function findByName(categories: CategoryRow[], name: string): CategoryRow | undefined {
  const k = key(name);
  return categories.find((c) => key(c.name) === k);
}

type PlannedAction =
  | {
      kind: "rename";
      from: CategoryRow;
      toName: string;
    }
  | {
      kind: "merge";
      from: CategoryRow;
      into: CategoryRow;
      toName: string;
    }
  | {
      kind: "skip";
      fromName: string;
      toName: string;
      reason: string;
    };

function planActions(categories: CategoryRow[], mapping: Record<string, string>): PlannedAction[] {
  const actions: PlannedAction[] = [];
  /** IDs déjà « consommés » dans ce plan (évite double traitement). */
  const consumed = new Set<string>();

  for (const [rawFrom, rawTo] of Object.entries(mapping)) {
    const fromName = norm(rawFrom);
    const toName = norm(rawTo);
    if (!fromName || !toName) {
      actions.push({
        kind: "skip",
        fromName: rawFrom,
        toName: rawTo,
        reason: "nom vide",
      });
      continue;
    }
    if (key(fromName) === key(toName)) {
      actions.push({
        kind: "skip",
        fromName,
        toName,
        reason: "ancien et nouveau nom identiques",
      });
      continue;
    }

    const from = findByName(categories, fromName);
    if (!from) {
      actions.push({
        kind: "skip",
        fromName,
        toName,
        reason: "catégorie source introuvable",
      });
      continue;
    }
    if (consumed.has(from.id)) {
      actions.push({
        kind: "skip",
        fromName: from.name,
        toName,
        reason: "déjà traitée dans ce plan",
      });
      continue;
    }

    const existingTarget = findByName(categories, toName);
    if (existingTarget && existingTarget.id !== from.id) {
      if (consumed.has(existingTarget.id)) {
        actions.push({
          kind: "skip",
          fromName: from.name,
          toName,
          reason: `cible « ${existingTarget.name} » déjà consommée dans ce plan`,
        });
        continue;
      }
      actions.push({ kind: "merge", from, into: existingTarget, toName: existingTarget.name });
      consumed.add(from.id);
      continue;
    }

    actions.push({ kind: "rename", from, toName });
    consumed.add(from.id);
  }

  return actions;
}

async function applyAction(action: Exclude<PlannedAction, { kind: "skip" }>): Promise<void> {
  if (action.kind === "rename") {
    await prisma.productCategory.update({
      where: { id: action.from.id },
      data: { name: action.toName },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const moved = await tx.product.updateMany({
      where: { categoryId: action.from.id },
      data: { categoryId: action.into.id },
    });
    await tx.productCategory.delete({ where: { id: action.from.id } });
    console.log(`    → ${moved.count} produit(s) réaffecté(s)`);
  });
}

function printCategories(categories: CategoryRow[]): void {
  console.log(`\nCatégories pharmacie (${categories.length}) :`);
  if (!categories.length) {
    console.log("  (aucune)");
    return;
  }
  for (const c of categories) {
    const flag = c.active ? "" : " [inactive]";
    console.log(`  - ${c.name.padEnd(32)} ${String(c.productsCount).padStart(4)} produit(s)${flag}`);
  }
}

function printPlan(actions: PlannedAction[]): void {
  console.log("\nPlan d’exécution :");
  if (!actions.length) {
    console.log("  (aucune entrée dans RENAMES)");
    return;
  }
  for (const action of actions) {
    if (action.kind === "skip") {
      console.log(`  SKIP  « ${action.fromName} » → « ${action.toName} »  (${action.reason})`);
      continue;
    }
    if (action.kind === "rename") {
      console.log(
        `  RENAME « ${action.from.name} » → « ${action.toName} »  (${action.from.productsCount} produit(s))`,
      );
      continue;
    }
    console.log(
      `  MERGE  « ${action.from.name} » → « ${action.into.name} »  (${action.from.productsCount} produit(s) à fusionner)`,
    );
  }
}

async function confirm(message: string): Promise<boolean> {
  if (autoYes) return true;
  if (!input.isTTY) {
    console.error("Entrée non interactive : ajoutez --yes pour appliquer, ou --dry-run pour l’aperçu.");
    return false;
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(`${message} [o/N] `)).trim().toLowerCase();
    return answer === "o" || answer === "oui" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main() {
  const categories = await loadCategories();
  printCategories(categories);

  if (listOnly) {
    return;
  }

  const entries = Object.entries(RENAMES).filter(([from, to]) => norm(from) && norm(to));
  if (!entries.length) {
    console.log(
      "\nAucune correspondance dans RENAMES.\nÉditez le tableau en tête de scripts/rename-pharmacy-categories.ts puis relancez.",
    );
    return;
  }

  const actions = planActions(categories, RENAMES);
  printPlan(actions);

  const writable = actions.filter((a): a is Exclude<PlannedAction, { kind: "skip" }> => a.kind !== "skip");
  if (!writable.length) {
    console.log("\nRien à appliquer.");
    return;
  }

  if (dryRun) {
    console.log("\nMode --dry-run : aucune modification écrite.");
    return;
  }

  const ok = await confirm(`\nAppliquer ${writable.length} opération(s) ?`);
  if (!ok) {
    console.log("Annulé.");
    return;
  }

  console.log("\nApplication…");
  for (const action of writable) {
    if (action.kind === "rename") {
      console.log(`  RENAME « ${action.from.name} » → « ${action.toName} »`);
    } else {
      console.log(`  MERGE  « ${action.from.name} » → « ${action.into.name} »`);
    }
    await applyAction(action);
  }

  const after = await loadCategories();
  printCategories(after);
  console.log("\nTerminé.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
