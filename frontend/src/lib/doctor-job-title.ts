/**
 * Infère le profil médecin depuis le libellé de poste
 * (doit rester aligné avec backend/src/lib/doctor-profile.ts).
 */
export function inferIsMedecinFromJobTitle(jobTitle?: string | null): boolean {
  const title = jobTitle?.trim().toLowerCase() ?? ''
  if (!title) return false
  if (
    /assistant|techni|infirm|aide[- ]?soign|laborantin|pharmacien|r[ée]ception|hygien|hygién|securit|sécurit|entretien/.test(
      title,
    )
  ) {
    return false
  }
  return /m[ée]decin|chirurgien|gyn[ée]colog|genecolog|ophtalmolog|radiolog|anesth[ée]s|p[ée]diatr|cardiolog|dermatolog|psychiatr|neurolog|urolog|rhumatolog|gastro|g[ée]n[ée]raliste|sp[ée]cialiste/.test(
    title,
  )
}
