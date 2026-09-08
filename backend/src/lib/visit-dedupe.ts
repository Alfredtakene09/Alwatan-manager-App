type VisitWithPatient = {
  id: string;
  patientId: string;
  updatedAt: Date;
};

export function keepLatestVisitPerPatient<T extends VisitWithPatient>(visits: T[]): T[] {
  const byPatient = new Map<string, T>();
  for (const visit of visits) {
    const existing = byPatient.get(visit.patientId);
    if (!existing || visit.updatedAt > existing.updatedAt) {
      byPatient.set(visit.patientId, visit);
    }
  }
  return Array.from(byPatient.values());
}

/**
 * Ne plus annuler en masse : un patient peut avoir une consultation ET un passage labo/externe
 * le même jour. L'affichage « une ligne par patient » passe par keepLatestVisitPerPatient.
 */
export async function cancelDuplicateActiveVisits(): Promise<number> {
  return 0;
}
