import bcrypt from "bcryptjs";
import { ConsultationRenewalPolicy, DoctorCompensationType, ExamCatalogKind, InterventionCategory, RoomType, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { EXAM_CATALOG_SEED } from "../src/lib/exam-catalog-seed.js";
import { DEFAULT_EMPLOYEE_JOB_TITLES } from "../src/lib/employee-job-titles-seed.js";
import { DEFAULT_EXPENSE_INDICES } from "../src/lib/expense-indices-seed.js";
import { DEFAULT_EXPENSE_CATEGORIES } from "../src/lib/expense-categories-seed.js";
import { seedDemoData } from "./seed-demo-data.js";

const password = "Clinique2026!";

type StaffSeed = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  jobTitle?: string;
  isMedecin?: boolean;
  fixedSalaryFcfa?: number | null;
  doctorCompensationType?: DoctorCompensationType;
  consultationTotalFcfa?: number | null;
  consultationQuotaPercent?: number | null;
  consultationValidityDays?: number | null;
  consultationRenewalPolicy?: ConsultationRenewalPolicy;
  surgeryQuotaPercent?: number | null;
};

async function upsertStaffMember(row: StaffSeed, passwordHash: string) {
  const isMedecin = row.isMedecin ?? row.role === UserRole.MEDECIN;
  const compensation = isMedecin
    ? {
        doctorCompensationType: row.doctorCompensationType ?? DoctorCompensationType.QUOTA,
        consultationTotalFcfa:
          row.doctorCompensationType === DoctorCompensationType.FIXED_SALARY
            ? null
            : row.consultationTotalFcfa ?? null,
        consultationQuotaPercent:
          row.doctorCompensationType === DoctorCompensationType.FIXED_SALARY
            ? null
            : row.consultationQuotaPercent ?? null,
        consultationValidityDays:
          row.doctorCompensationType === DoctorCompensationType.FIXED_SALARY
            ? null
            : row.consultationValidityDays ?? 30,
        consultationRenewalPolicy:
          row.doctorCompensationType === DoctorCompensationType.FIXED_SALARY
            ? ConsultationRenewalPolicy.FULL
            : row.consultationRenewalPolicy ?? ConsultationRenewalPolicy.FULL,
        surgeryQuotaPercent:
          row.doctorCompensationType === DoctorCompensationType.FIXED_SALARY
            ? null
            : row.surgeryQuotaPercent ?? null,
      }
    : {
        doctorCompensationType: DoctorCompensationType.QUOTA,
        consultationTotalFcfa: null,
        consultationQuotaPercent: null,
        surgeryQuotaPercent: null,
      };

  const existingUser = await prisma.user.findUnique({
    where: { username: row.username },
    select: { id: true, employeeId: true },
  });

  let employeeId = existingUser?.employeeId;
  if (employeeId) {
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        firstName: row.firstName,
        lastName: row.lastName,
        jobTitle: row.jobTitle ?? null,
        isMedecin,
        fixedSalaryFcfa: row.fixedSalaryFcfa ?? undefined,
        active: true,
        ...compensation,
      },
    });
  } else {
    const employee = await prisma.employee.create({
      data: {
        firstName: row.firstName,
        lastName: row.lastName,
        jobTitle: row.jobTitle ?? null,
        isMedecin,
        fixedSalaryFcfa: row.fixedSalaryFcfa ?? undefined,
        active: true,
        ...compensation,
      },
    });
    employeeId = employee.id;
  }

  await prisma.user.upsert({
    where: { username: row.username },
    update: {
      email: row.email,
      passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      employeeId,
      active: true,
    },
    create: {
      username: row.username,
      email: row.email,
      passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      employeeId,
      active: true,
    },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(password, 10);

  const staff: StaffSeed[] = [
    {
      username: "admin",
      email: "admin@alwatan.local",
      firstName: "Admin",
      lastName: "Système",
      role: UserRole.ADMIN,
      jobTitle: "Administrateur système",
    },
    {
      username: "gestionnaire",
      email: "gestionnaire@alwatan.local",
      firstName: "Mahamat",
      lastName: "Hassan",
      role: UserRole.GESTIONNAIRE,
      jobTitle: "Gestionnaire financier",
      fixedSalaryFcfa: 350000,
    },
    {
      username: "reception",
      email: "reception@alwatan.local",
      firstName: "Amina",
      lastName: "Hassan",
      role: UserRole.RECEPTIONNISTE,
      jobTitle: "Réceptionniste",
    },
    {
      username: "medecin",
      email: "medecin@alwatan.local",
      firstName: "Dr Ibrahim",
      lastName: "Mahamat",
      role: UserRole.MEDECIN,
      jobTitle: "Médecin généraliste",
      isMedecin: true,
      doctorCompensationType: DoctorCompensationType.QUOTA,
      consultationTotalFcfa: 5000,
      consultationQuotaPercent: 60,
      consultationValidityDays: 30,
      consultationRenewalPolicy: ConsultationRenewalPolicy.FULL,
      surgeryQuotaPercent: 60,
    },
    {
      username: "medecin2",
      email: "medecin2@alwatan.local",
      firstName: "Dr Aïcha",
      lastName: "Adam",
      role: UserRole.MEDECIN,
      jobTitle: "Médecin généraliste",
      isMedecin: true,
      doctorCompensationType: DoctorCompensationType.FIXED_SALARY,
    },
    {
      username: "direction",
      email: "direction@alwatan.local",
      firstName: "Fatimé",
      lastName: "Abakar",
      role: UserRole.COMPTABLE,
      jobTitle: "Direction",
    },
    {
      username: "laborantin",
      email: "laborantin@alwatan.local",
      firstName: "Moussa",
      lastName: "Djibrine",
      role: UserRole.LABORANTIN,
      jobTitle: "Laborantin",
    },
    {
      username: "pharmacie",
      email: "pharmacie@alwatan.local",
      firstName: "Saleh",
      lastName: "Youssouf",
      role: UserRole.PHARMACIEN,
      jobTitle: "Pharmacien",
    },
  ];

  // Migration compte comptable → direction (avant upsert, pour conserver l'historique)
  const legacyComptable = await prisma.user.findFirst({
    where: {
      OR: [
        { username: "comptable" },
        { username: { startsWith: "legacy_comptable" } },
      ],
    },
    select: { id: true, employeeId: true, passwordHash: true },
  });
  const existingDirection = await prisma.user.findUnique({
    where: { username: "direction" },
    select: { id: true, employeeId: true },
  });
  if (existingDirection) {
    await prisma.user.update({
      where: { id: existingDirection.id },
      data: {
        role: UserRole.COMPTABLE,
        email: "direction@alwatan.local",
        active: true,
        ...(legacyComptable?.passwordHash
          ? { passwordHash: legacyComptable.passwordHash }
          : {}),
      },
    });
    if (existingDirection.employeeId) {
      await prisma.employee.update({
        where: { id: existingDirection.employeeId },
        data: { jobTitle: "Direction" },
      });
    }
    if (legacyComptable && legacyComptable.id !== existingDirection.id) {
      try {
        await prisma.user.delete({ where: { id: legacyComptable.id } });
      } catch {
        await prisma.user.update({
          where: { id: legacyComptable.id },
          data: {
            active: false,
            username: `legacy_comptable_${legacyComptable.id.slice(0, 8)}`,
            email: `legacy_comptable_${legacyComptable.id.slice(0, 8)}@alwatan.local`,
          },
        });
      }
    }
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
  }

  for (const member of staff) {
    await upsertStaffMember(member, passwordHash);
  }

  // Supprimer tous les comptes application au rôle soignant
  const soignantUsers = await prisma.user.findMany({
    where: {
      OR: [
        { role: UserRole.SOIGNANT },
        { username: "soignant" },
        { email: "soignant@alwatan.local" },
      ],
    },
    select: { id: true, employeeId: true },
  });
  for (const user of soignantUsers) {
    try {
      await prisma.user.delete({ where: { id: user.id } });
    } catch {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          active: false,
          username: `deleted_soignant_${user.id.slice(0, 8)}`,
          email: `deleted_soignant_${user.id.slice(0, 8)}@alwatan.local`,
        },
      });
    }
  }

  const hawaEmployee = await prisma.employee.findFirst({
    where: { firstName: "Hawa", lastName: "Oumar" },
  });
  if (hawaEmployee) {
    await prisma.employee.update({
      where: { id: hawaEmployee.id },
      data: { jobTitle: "Infirmière", active: true, isMedecin: false },
    });
  } else {
    await prisma.employee.create({
      data: {
        firstName: "Hawa",
        lastName: "Oumar",
        jobTitle: "Infirmière",
        isMedecin: false,
        active: true,
      },
    });
  }

  for (const [index, label] of DEFAULT_EMPLOYEE_JOB_TITLES.entries()) {
    await prisma.employeeJobTitle.upsert({
      where: { label },
      update: { active: true, sortOrder: index },
      create: { label, active: true, sortOrder: index },
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

  const unlinkedEmployee = await prisma.employee.findFirst({
    where: { firstName: "Zara", lastName: "Mahamat", user: { is: null } },
  });
  if (!unlinkedEmployee) {
    await prisma.employee.create({
      data: {
        firstName: "Zara",
        lastName: "Mahamat",
        jobTitle: "Aide-soignante",
        isMedecin: false,
        active: true,
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

  const products = [
    { name: "Paracétamol 500mg", sku: "MED-PARA-500", quantity: 500, unitPriceFcfa: 150, minStock: 50 },
    { name: "Amoxicilline 500mg", sku: "MED-AMOX-500", quantity: 300, unitPriceFcfa: 450, minStock: 40 },
    { name: "Sérum physiologique 500ml", sku: "MED-SERUM-500", quantity: 120, unitPriceFcfa: 800, minStock: 20 },
    { name: "Bande élastique", sku: "CONS-BANDE-EL", quantity: 80, unitPriceFcfa: 350, minStock: 15 },
  ];

  for (const product of products) {
    await prisma.product.upsert({ where: { sku: product.sku }, update: product, create: product });
  }

  await seedDemoData();

  console.log("Seed terminé. Mot de passe:", password);
  console.log("Données démo : patients DEMO-PAT-*, employés Démo Salarié — npm run db:seed:demo pour régénérer (~350 enregistrements)");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
