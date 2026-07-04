export const DEFAULT_EXPENSE_INDICES: ReadonlyArray<{
  name: string;
  description: string;
}> = [
  { name: "Entretien", description: "Achat produits d'entretien, fournitures de bureau" },
  { name: "Transport", description: "Carburant, course, transport patient" },
  { name: "Maintenance", description: "Réparation équipement, maintenance bâtiment" },
  { name: "Achat urgent", description: "Médicaments ou consommables en urgence" },
] as const;
