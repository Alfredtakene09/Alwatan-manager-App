/**
 * Migre les catégories pharmacie qui sont en réalité des formes galéniques
 * vers ProductForm + Product.pharmaceuticalForm, puis détache / supprime
 * ces catégories.
 *
 * Usage :
 *   npx tsx scripts/migrate-pharmacy-categories-to-forms.ts
 *   npx tsx scripts/migrate-pharmacy-categories-to-forms.ts --dry-run
 *   npx tsx scripts/migrate-pharmacy-categories-to-forms.ts --yes
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { prisma } from "../src/lib/db.js";
import { DEFAULT_PRODUCT_FORMS } from "../src/lib/product-forms-seed.js";

/** Normalisation des libellés « catégorie = forme » vers le nom canonique de forme. */
const FORM_ALIASES: Record<string, string> = {
  comprimé: "Comprimé",
  comprime: "Comprimé",
  comprimés: "Comprimé",
  comprimes: "Comprimé",
  gélule: "Gélule",
  gelule: "Gélule",
  gélules: "Gélule",
  gelules: "Gélule",
  sirop: "Sirop",
  sirops: "Sirop",
  suspension: "Suspension",
  injection: "Injection",
  injectable: "Injection",
  injectables: "Injection",
  pommade: "Pommade",
  crème: "Crème",
  creme: "Crème",
  cream: "Crème",
  creams: "Crème",
  suppositoire: "Suppositoire",
  gouttes: "Gouttes",
  collyre: "Collyre",
  sachet: "Sachet",
  sachets: "Sachet",
  solution: "Solution",
  inhalable: "Inhalable",
  inhalation: "Inhalable",
  divers: "Autre",
  autre: "Autre",
  autres: "Autre",
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const autoYes = args.includes("--yes");

function normKey(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ");
}

function canonicalFormName(categoryName: string): string {
  const alias = FORM_ALIASES[normKey(categoryName)];
  if (alias) return alias;
  const defaults = DEFAULT_PRODUCT_FORMS as readonly string[];
  const hit = defaults.find((name) => normKey(name) === normKey(categoryName));
  return hit ?? categoryName.trim();
}

async function confirm(message: string): Promise<boolean> {
  if (autoYes) return true;
  if (!input.isTTY) {
    console.error("Entrée non interactive : ajoutez --yes ou --dry-run.");
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

async function ensureForm(name: string, sortOrder: number): Promise<string> {
  const existing = await prisma.productForm.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    if (existing.name !== name) {
      await prisma.productForm.update({ where: { id: existing.id }, data: { name } });
    }
    if (!existing.active) {
      await prisma.productForm.update({ where: { id: existing.id }, data: { active: true } });
    }
    return existing.id;
  }
  const created = await prisma.productForm.create({
    data: { name, sortOrder, active: true },
  });
  return created.id;
}

async function main() {
  const categories = await prisma.productCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { products: true } },
      products: { select: { id: true, name: true, pharmaceuticalForm: true } },
    },
  });

  if (!categories.length) {
    console.log("Aucune catégorie pharmacie à migrer.");
    return;
  }

  console.log(`\nCatégories à migrer vers formes (${categories.length}) :`);
  for (const cat of categories) {
    const formName = canonicalFormName(cat.name);
    console.log(
      `  « ${cat.name} » → forme « ${formName} »  (${cat._count.products} produit(s))`,
    );
  }

  if (dryRun) {
    console.log("\nMode --dry-run : aucune modification écrite.");
    return;
  }

  const ok = await confirm("\nMigrer toutes ces catégories vers les formes ?");
  if (!ok) {
    console.log("Annulé.");
    return;
  }

  // Garantir le catalogue de formes par défaut
  for (const [index, name] of DEFAULT_PRODUCT_FORMS.entries()) {
    await ensureForm(name, index);
  }

  let filledForm = 0;
  let keptExistingForm = 0;
  let deletedCategories = 0;

  for (const [index, cat] of categories.entries()) {
    const formName = canonicalFormName(cat.name);
    await ensureForm(formName, DEFAULT_PRODUCT_FORMS.length + index);

    for (const product of cat.products) {
      const previous = product.pharmaceuticalForm?.trim() || null;
      if (previous) {
        // Conserve une forme déjà renseignée ; on détache juste la catégorie.
        await prisma.product.update({
          where: { id: product.id },
          data: { categoryId: null },
        });
        keptExistingForm += 1;
      } else {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            pharmaceuticalForm: formName,
            categoryId: null,
          },
        });
        filledForm += 1;
      }
    }

    await prisma.product.updateMany({
      where: { categoryId: cat.id },
      data: { categoryId: null },
    });

    await prisma.productCategory.delete({ where: { id: cat.id } });
    deletedCategories += 1;
    console.log(`  OK « ${cat.name} » → forme « ${formName} »`);
  }

  const remainingCats = await prisma.productCategory.count();
  const forms = await prisma.productForm.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true },
  });
  const linked = await prisma.product.count({ where: { pharmaceuticalForm: { not: null } } });

  console.log("\nRésumé :");
  console.log(`  Catégories supprimées        : ${deletedCategories}`);
  console.log(`  Catégories restantes         : ${remainingCats}`);
  console.log(`  Formes renseignées (vides)   : ${filledForm}`);
  console.log(`  Formes déjà présentes (keep) : ${keptExistingForm}`);
  console.log(`  Produits avec forme          : ${linked}`);
  console.log(`  Formes désormais en base     : ${forms.map((f) => f.name).join(", ")}`);
  console.log("\nTerminé. Les produits n’ont plus de catégorie — à reclasser si besoin.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
