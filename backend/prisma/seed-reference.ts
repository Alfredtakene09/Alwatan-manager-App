import { ExamCatalogKind, InterventionCategory, RoomType } from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { EXAM_CATALOG_SEED } from "../src/lib/exam-catalog-seed.js";
import { DEFAULT_EMPLOYEE_JOB_TITLES } from "../src/lib/employee-job-titles-seed.js";
import { DEFAULT_CLINIC_SERVICES } from "../src/lib/clinic-services-seed.js";
import { DEFAULT_EXPENSE_INDICES } from "../src/lib/expense-indices-seed.js";
import { DEFAULT_EXPENSE_CATEGORIES } from "../src/lib/expense-categories-seed.js";
import { DEFAULT_PRODUCT_FORMS } from "../src/lib/product-forms-seed.js";
import {
  PETITE_CHIRURGIE_CATALOG_ITEMS,
  PETITE_CHIRURGIE_SURGEON_PERCENT,
} from "../src/lib/petite-chirurgie-catalog.js";
import { ensurePrintedTariffCatalogItems } from "../src/lib/printed-tariff-catalog.js";

/** Comptes créés par le seed — conservés lors d'une réinitialisation de la base. */
export const DEFAULT_STAFF_USERNAMES = ["Root", "gestionnaire", "pharmacie"] as const;

/** Données de référence (catalogues, chambres, stocks initiaux) sans comptes ni démo. */
export async function seedReferenceData() {
  for (const [index, label] of DEFAULT_EMPLOYEE_JOB_TITLES.entries()) {
    await prisma.employeeJobTitle.upsert({
      where: { label },
      update: { active: true, sortOrder: index },
      create: { label, active: true, sortOrder: index },
    });
  }

  for (const [index, name] of DEFAULT_CLINIC_SERVICES.entries()) {
    await prisma.clinicService.upsert({
      where: { name },
      update: { active: true, sortOrder: index },
      create: { name, active: true, sortOrder: index },
    });
  }

  for (const [index, item] of DEFAULT_EXPENSE_INDICES.entries()) {
    await prisma.clinicExpenseIndice.upsert({
      where: { name: item.name },
      update: { active: true, sortOrder: index, description: item.description },
      create: {
        name: item.name,
        description: item.description,
        active: true,
        sortOrder: index,
      },
    });
  }

  for (const [index, item] of DEFAULT_EXPENSE_CATEGORIES.entries()) {
    await prisma.expenseCategory.upsert({
      where: { name: item.name },
      update: {
        icon: item.icon,
        color: item.color,
        sortOrder: item.sortOrder ?? index,
        archived: false,
      },
      create: {
        name: item.name,
        icon: item.icon,
        color: item.color,
        sortOrder: item.sortOrder ?? index,
      },
    });
  }

  const interventions = [
    { code: "CHIR-A", label: "Chirurgie Majeure (Type A)", category: InterventionCategory.MAJEURE_A, totalCostFcfa: 350000, surgeonPercent: 60 },
    { code: "CHIR-B", label: "Chirurgie Moyenne (Type B)", category: InterventionCategory.MOYENNE_B, totalCostFcfa: 150000, surgeonPercent: 65 },
    { code: "CHIR-C", label: "Petite Chirurgie (Type C)", category: InterventionCategory.PETITE_C, totalCostFcfa: 70000, surgeonPercent: 70 },
  ];

  for (const intervention of interventions) {
    await prisma.interventionType.upsert({ where: { code: intervention.code }, update: intervention, create: intervention });
  }

  const blocService = await prisma.clinicService.findFirst({
    where: { name: "Bloc opératoire" },
    select: { id: true },
  });
  for (const item of PETITE_CHIRURGIE_CATALOG_ITEMS) {
    await prisma.interventionType.upsert({
      where: { code: item.code },
      // Additif : ne pas écraser un tarif déjà saisi en production.
      update: {},
      create: {
        code: item.code,
        label: item.label,
        category: InterventionCategory.PETITE_C,
        totalCostFcfa: item.totalCostFcfa,
        surgeonPercent: PETITE_CHIRURGIE_SURGEON_PERCENT,
        clinicServiceId: blocService?.id ?? null,
      },
    });
  }

  await ensurePrintedTariffCatalogItems();

  for (const kind of Object.values(ExamCatalogKind)) {
    for (const item of EXAM_CATALOG_SEED[kind]) {
      await prisma.examCatalogItem.upsert({
        where: { kind_code: { kind, code: item.code } },
        update: {
          label: item.label,
          category: item.category ?? null,
          priceFcfa: item.priceFcfa,
          sortOrder: item.sortOrder ?? 0,
          active: true,
        },
        create: {
          kind,
          code: item.code,
          label: item.label,
          category: item.category ?? null,
          priceFcfa: item.priceFcfa,
          sortOrder: item.sortOrder ?? 0,
          active: true,
        },
      });
    }
  }

  const rooms = [
    { name: "VIP 101", type: RoomType.VIP, description: "Chambre individuelle climatisée premium", dailyRateFcfa: 75000 },
    { name: "VIP 102", type: RoomType.VIP, description: "Chambre individuelle climatisée premium", dailyRateFcfa: 75000 },
    { name: "Simple A", type: RoomType.SIMPLE, description: "Salle commune tarifée de base", dailyRateFcfa: 25000 },
    { name: "Simple B", type: RoomType.SIMPLE, description: "Salle commune tarifée de base", dailyRateFcfa: 25000 },
  ];

  for (const room of rooms) {
    const existing = await prisma.room.findFirst({ where: { name: room.name } });
    if (existing) {
      await prisma.room.update({ where: { id: existing.id }, data: room });
    } else {
      await prisma.room.create({ data: room });
    }
  }

  for (const [index, name] of DEFAULT_PRODUCT_FORMS.entries()) {
    await prisma.productForm.upsert({
      where: { name },
      update: { active: true, sortOrder: index },
      create: { name, active: true, sortOrder: index },
    });
  }

  const products = [
    { name: "Paracétamol 500mg", sku: "MED-PARA-500", quantity: 500, unitPriceFcfa: 150, minStock: 50 },
    { name: "Amoxicilline 500mg", sku: "MED-AMOX-500", quantity: 300, unitPriceFcfa: 450, minStock: 40 },
    { name: "Sérum physiologique 500ml", sku: "MED-SERUM-500", quantity: 120, unitPriceFcfa: 800, minStock: 20 },
    { name: "Bande élastique", sku: "CONS-BANDE-EL", quantity: 80, unitPriceFcfa: 350, minStock: 15 },
  ];

  for (const product of products) {
    await prisma.product.upsert({ where: { sku: product.sku }, update: product, create: product });
  }

  const logisticsCategories = [
    { name: "Consommables médicaux", sortOrder: 0 },
    { name: "Réactifs laboratoire", sortOrder: 1 },
    { name: "Fournitures de bureau", sortOrder: 2 },
    { name: "Entretien & hygiène", sortOrder: 3 },
  ];
  const categoryByName = new Map<string, string>();
  for (const category of logisticsCategories) {
    const saved = await prisma.logisticsCategory.upsert({
      where: { name: category.name },
      update: { sortOrder: category.sortOrder, active: true },
      create: category,
    });
    categoryByName.set(saved.name, saved.id);
  }

  let logisticsSupplier = await prisma.logisticsSupplier.findFirst({ where: { name: "Fournitures Générales Tchad" } });
  if (!logisticsSupplier) {
    logisticsSupplier = await prisma.logisticsSupplier.create({
      data: {
        name: "Fournitures Générales Tchad",
        contactName: "Service commercial",
        phone: "+235 66 00 00 00",
        email: "contact@fournitures-tchad.local",
      },
    });
  }

  const logisticsItems = [
    { name: "Gants nitrile (boîte 100)", sku: "LOG-GANTS-NIT", unit: "boîte", category: "Consommables médicaux", quantity: 40, unitCostFcfa: 6500, minStock: 10 },
    { name: "Seringues 5ml (boîte 100)", sku: "LOG-SERINGUE-5", unit: "boîte", category: "Consommables médicaux", quantity: 25, unitCostFcfa: 8000, minStock: 8 },
    { name: "Compresses stériles (paquet)", sku: "LOG-COMPRESSE", unit: "paquet", category: "Consommables médicaux", quantity: 60, unitCostFcfa: 1200, minStock: 15 },
    { name: "Tubes EDTA (boîte 100)", sku: "LOG-TUBE-EDTA", unit: "boîte", category: "Réactifs laboratoire", quantity: 12, unitCostFcfa: 9500, minStock: 5 },
    { name: "Alcool 70° (bidon 5L)", sku: "LOG-ALCOOL-5L", unit: "bidon", category: "Entretien & hygiène", quantity: 8, unitCostFcfa: 4500, minStock: 4 },
    { name: "Ramette papier A4", sku: "LOG-PAPIER-A4", unit: "ramette", category: "Fournitures de bureau", quantity: 30, unitCostFcfa: 3500, minStock: 6 },
  ];
  for (const item of logisticsItems) {
    const { category, ...rest } = item;
    await prisma.logisticsItem.upsert({
      where: { sku: item.sku },
      update: { ...rest, categoryId: categoryByName.get(category) ?? null, supplierId: logisticsSupplier.id, active: true },
      create: { ...rest, categoryId: categoryByName.get(category) ?? null, supplierId: logisticsSupplier.id, noExpiry: true },
    });
  }
}
