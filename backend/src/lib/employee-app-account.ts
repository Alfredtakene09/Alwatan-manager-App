/** Postes gérés uniquement dans le registre (paie, effectif) — pas de connexion application. */
export function employeeNeedsAppAccount(jobTitle?: string | null): boolean {
  const title = jobTitle?.trim().toLowerCase() ?? "";
  if (!title) return true;
  return !title.includes("soignant") && !title.includes("infirm");
}
