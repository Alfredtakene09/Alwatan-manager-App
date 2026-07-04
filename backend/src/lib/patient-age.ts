import { AgeUnit } from "@prisma/client";
import { z } from "zod";

export const AGE_UNIT_MAX: Record<AgeUnit, number> = {
  YEARS: 150,
  MONTHS: 23,
  DAYS: 60,
};

export const ageUnitSchema = z.nativeEnum(AgeUnit).optional().default(AgeUnit.YEARS);

export function validatePatientAge(
  age: number | null | undefined,
  unit: AgeUnit = AgeUnit.YEARS,
): boolean {
  if (age == null) return true;
  if (!Number.isInteger(age)) return false;
  const max = AGE_UNIT_MAX[unit];
  return age >= 0 && age <= max;
}

export function formatPatientAge(
  age: number | null | undefined,
  unit: AgeUnit = AgeUnit.YEARS,
): string | null {
  if (age == null) return null;
  if (unit === AgeUnit.MONTHS) return age <= 1 ? `${age} mois` : `${age} mois`;
  if (unit === AgeUnit.DAYS) return age <= 1 ? `${age} jour` : `${age} jours`;
  return age <= 1 ? `${age} an` : `${age} ans`;
}

export function refinePatientAge(
  data: { age?: number | null; ageUnit?: AgeUnit },
  ctx: z.RefinementCtx,
) {
  const unit = data.ageUnit ?? AgeUnit.YEARS;
  if (data.age != null && !validatePatientAge(data.age, unit)) {
    const label = unit === AgeUnit.MONTHS ? "mois" : unit === AgeUnit.DAYS ? "jours" : "ans";
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Âge invalide (0–${AGE_UNIT_MAX[unit]} ${label})`,
      path: ["age"],
    });
  }
}

export const patientAgeShape = {
  age: z.number().int().min(0).optional(),
  ageUnit: ageUnitSchema,
};
