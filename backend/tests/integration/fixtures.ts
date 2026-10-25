/**
 * Données insérées dans « alwatan_test » pour les tests (jamais dans la base de travail).
 * Mot de passe commun aux comptes de test : TEST_PASSWORD.
 */
import bcrypt from "bcryptjs";
import {
  ConsultationQuotaMode,
  DoctorCompensationType,
  ExamCatalogKind,
  ReceptionShiftSlot,
  UserRole,
} from "@prisma/client";

export const TEST_PASSWORD = "Test-Alwatan-2026!";

export const FEES = {
  gynConsultation: 10_000,
  ophtaConsultation: 8_000,
  consultationQuotaPercent: 50,
  surgeryQuotaPercent: 60,
  anesthetistPercent: 10,
  salary: 100_000,
  examPrice: 5_000,
  productSalePrice: 1_000,
  productPurchasePrice: 600,
};

export type Fixtures = Awaited<ReturnType<typeof insertFixtures>>;

export async function insertFixtures() {
  const { prisma } = await import("../../src/lib/db.js");
  const [{ current_database: dbName }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (!dbName.endsWith("_test")) throw new Error(`Refus : base « ${dbName} » n'est pas une base de test.`);

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  const service = async (name: string) =>
    prisma.clinicService.upsert({ where: { name }, update: { active: true }, create: { name } });
  const gyn = await service("Gynécologie");
  const surgery = await service("Chirurgie Générale");
  const ophta = await service("Ophtalmologie");

  const user = async (
    username: string,
    role: UserRole,
    employee: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) =>
    prisma.user.create({
      data: {
        username,
        email: `${username}@test.local`,
        passwordHash,
        firstName: username,
        lastName: "Test",
        role,
        ...extra,
        employee: { create: { firstName: username, lastName: "Test", ...employee } },
      },
      include: { employee: true },
    });

  const doctorProfile = (consultationTotalFcfa: number, clinicServiceId: string) => ({
    isMedecin: true,
    jobTitle: "Médecin",
    doctorCompensationType: DoctorCompensationType.QUOTA,
    consultationTotalFcfa,
    consultationQuotaMode: ConsultationQuotaMode.PERCENT,
    consultationQuotaPercent: FEES.consultationQuotaPercent,
    surgeryQuotaPercent: FEES.surgeryQuotaPercent,
    clinicServiceId,
  });

  const admin = await user("admin_test", UserRole.ADMIN);
  const gestionnaire = await user("gest_test", UserRole.GESTIONNAIRE);
  const reception = await user("recep_test", UserRole.RECEPTIONNISTE, {}, { cashShiftSlot: ReceptionShiftSlot.MORNING });
  const comptable = await user("compta_test", UserRole.COMPTABLE);
  const pharmacist = await user("pharma_test", UserRole.PHARMACIEN);
  const drGyn = await user("dr_gyn", UserRole.MEDECIN, doctorProfile(FEES.gynConsultation, gyn.id));
  const drSurgery = await user("dr_chir", UserRole.MEDECIN, doctorProfile(FEES.gynConsultation, surgery.id));
  const drOphta = await user("dr_ophta", UserRole.MEDECIN, doctorProfile(FEES.ophtaConsultation, ophta.id));
  const anesthetist = await user("dr_anesth", UserRole.MEDECIN, {
    isMedecin: true,
    jobTitle: "Anesthésiste",
    doctorCompensationType: DoctorCompensationType.QUOTA,
    surgeryQuotaPercent: FEES.anesthetistPercent,
  });

  for (const [doctor, svc] of [
    [drGyn, gyn],
    [drSurgery, surgery],
    [drOphta, ophta],
  ] as const) {
    await prisma.clinicServiceDoctor.create({
      data: { employeeId: doctor.employeeId, clinicServiceId: svc.id, isDefault: true },
    });
  }

  const salaried = await prisma.employee.create({
    data: { firstName: "Salarie", lastName: "Paie", jobTitle: "Agent", fixedSalaryFcfa: FEES.salary },
  });
  const bigAdvanceEmployee = await prisma.employee.create({
    data: { firstName: "Grosse", lastName: "Avance", jobTitle: "Agent", fixedSalaryFcfa: FEES.salary },
  });

  const exam = await prisma.examCatalogItem.create({
    data: {
      kind: ExamCatalogKind.EXAMEN,
      code: "TEST-GLY",
      label: "Glycémie test",
      priceFcfa: FEES.examPrice,
    },
  });

  const supplier = await prisma.pharmacySupplier.create({ data: { name: "Fournisseur Test" } });
  const product = await prisma.product.create({
    data: {
      name: "Paracetamol Test",
      sku: "TEST-PARA",
      quantity: 50,
      unitPriceFcfa: FEES.productSalePrice,
      purchasePriceFcfa: FEES.productPurchasePrice,
      supplierId: supplier.id,
    },
  });

  await prisma.$disconnect();

  return {
    services: { gyn, surgery, ophta },
    users: { admin, gestionnaire, reception, comptable, pharmacist, drGyn, drSurgery, drOphta, anesthetist },
    employees: { salaried, bigAdvanceEmployee },
    exam,
    supplier,
    product,
  };
}
