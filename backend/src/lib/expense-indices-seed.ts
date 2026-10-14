export const DEFAULT_EXPENSE_INDICES: ReadonlyArray<{
  name: string;
  description: string;
  flow: "SORTIE" | "ENTREE";
}> = [
  { name: "Entretien", description: "Achat produits d'entretien, fournitures de bureau", flow: "SORTIE" },
  { name: "Transport", description: "Carburant, course, transport patient", flow: "SORTIE" },
  { name: "Maintenance", description: "Réparation équipement, maintenance bâtiment", flow: "SORTIE" },
  { name: "Achat urgent", description: "Médicaments ou consommables en urgence", flow: "SORTIE" },
] as const;
