/**
 * Audit: médecins liés aux services mais sans compte utilisateur actif.
 *
 * Usage:
 *   npx tsx scripts/audit-service-doctors-without-user.ts
 */
import { prisma } from "../src/lib/db.js";

async function main() {
  const services = await prisma.clinicService.findMany({
    where: { active: true },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      employees: {
        where: { isMedecin: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          active: true,
          user: {
            select: {
              id: true,
              active: true,
              role: true,
              username: true,
            },
          },
        },
      },
    },
  });

  const report = services
    .map((service) => {
      const doctorsWithoutActiveUser = service.employees.filter(
        (doctor) => !doctor.user || !doctor.user.active,
      );
      return {
        serviceId: service.id,
        serviceName: service.name,
        linkedDoctors: service.employees.length,
        doctorsWithoutActiveUserCount: doctorsWithoutActiveUser.length,
        doctorsWithoutActiveUser: doctorsWithoutActiveUser.map((doctor) => ({
          employeeId: doctor.id,
          firstName: doctor.firstName,
          lastName: doctor.lastName,
          employeeActive: doctor.active,
          userId: doctor.user?.id ?? null,
          userActive: doctor.user?.active ?? null,
          username: doctor.user?.username ?? null,
          userRole: doctor.user?.role ?? null,
        })),
      };
    })
    .filter((service) => service.doctorsWithoutActiveUserCount > 0);

  const totals = {
    servicesChecked: services.length,
    servicesWithIssues: report.length,
    doctorsLinked: services.reduce((sum, s) => sum + s.employees.length, 0),
    doctorsWithoutActiveUser: report.reduce(
      (sum, s) => sum + s.doctorsWithoutActiveUserCount,
      0,
    ),
  };

  console.log(
    JSON.stringify(
      {
        totals,
        report,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
