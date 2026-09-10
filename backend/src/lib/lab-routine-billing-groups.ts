/**
 * Groupes de facturation Routine (miroir frontend lab-routine-billing-groups).
 * Urine Analysis + Disposite = 1 tarif ; Stool General + Miscroscopic = 1 tarif.
 */

export type RoutineBillingGroupDef = {
  id: "urine" | "stool";
  label: string;
  families: string[];
};

export function classicSectionFamily(section: string | null | undefined): string {
  const raw = (section ?? "").trim().toLowerCase();
  if (!raw) return "main";
  if (raw.includes("deposit") || raw.includes("disposit") || raw.includes("diposit")) {
    return "urine-deposit";
  }
  if (raw.includes("urine")) return "urine-general";
  if (
    raw.includes("microscopic") ||
    raw.includes("miscrocopic") ||
    raw.includes("miscroscopic") ||
    raw.includes("miscro") ||
    raw.includes("micro")
  ) {
    return "stool-micro";
  }
  if (raw.includes("stool") || raw.includes("selle")) return "stool-general";
  return raw;
}

export const ROUTINE_BILLING_GROUPS: RoutineBillingGroupDef[] = [
  {
    id: "urine",
    label: "Urine Analysis",
    families: ["urine-general", "urine-deposit"],
  },
  {
    id: "stool",
    label: "Stool General",
    families: ["stool-general", "stool-micro"],
  },
];

export function billingGroupForSectionTitle(
  title: string | null | undefined,
): RoutineBillingGroupDef | null {
  const trimmed = title?.trim();
  if (!trimmed || trimmed.toLowerCase() === "formulaire principal") return null;
  const family = classicSectionFamily(trimmed);
  return ROUTINE_BILLING_GROUPS.find((group) => group.families.includes(family)) ?? null;
}
