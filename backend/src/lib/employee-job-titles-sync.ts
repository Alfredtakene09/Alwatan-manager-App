import { prisma } from "./db.js";
import { DEFAULT_EMPLOYEE_JOB_TITLES } from "./employee-job-titles-seed.js";

type JobTitleRow = {
  id: string;
  label: string;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type JobTitleWithUsage = JobTitleRow & { employeeCount: number };

async function employeeCountByLabel() {
  const rows = await prisma.employee.groupBy({
    by: ["jobTitle"],
    where: { jobTitle: { not: null } },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.jobTitle!, row._count._all]));
}

export async function serializeJobTitlesWithUsage(items: JobTitleRow[]): Promise<JobTitleWithUsage[]> {
  const counts = await employeeCountByLabel();
  return items.map((item) => ({
    ...item,
    employeeCount: counts.get(item.label) ?? 0,
  }));
}

export async function countEmployeesForJobTitle(label: string) {
  return prisma.employee.count({ where: { jobTitle: label } });
}

/** Importe la liste par défaut + les postes déjà saisis sur les fiches employés. */
export async function syncEmployeeJobTitles() {
  for (const [index, label] of DEFAULT_EMPLOYEE_JOB_TITLES.entries()) {
    await prisma.employeeJobTitle.upsert({
      where: { label },
      update: { active: true, sortOrder: index },
      create: { label, active: true, sortOrder: index },
    });
  }

  const employeeTitles = await prisma.employee.findMany({
    where: { jobTitle: { not: null } },
    select: { jobTitle: true },
    distinct: ["jobTitle"],
  });

  const defaultSet = new Set<string>(DEFAULT_EMPLOYEE_JOB_TITLES);
  let extraOrder = DEFAULT_EMPLOYEE_JOB_TITLES.length;

  for (const row of employeeTitles) {
    const label = row.jobTitle?.trim();
    if (!label || defaultSet.has(label)) continue;

    await prisma.employeeJobTitle.upsert({
      where: { label },
      update: {},
      create: { label, active: true, sortOrder: extraOrder++ },
    });
  }

  return prisma.employeeJobTitle.count();
}
