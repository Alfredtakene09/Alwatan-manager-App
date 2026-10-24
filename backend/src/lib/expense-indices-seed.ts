export const DEFAULT_EXPENSE_INDICES: ReadonlyArray<{
  name: string;
  description: string;
  flow: "SORTIE" | "ENTREE";
}> = [
  { name: "Entretien", description: "Achat produits d'entretien, fournitures de bureau", flow: "SORTIE" },
  { name: "Transport", description: "Carburant, course, transport patient", flow: "SORTIE" },
  { name: "Maintenance", description: "Réparation équipement, maintenance bâtiment", flow: "SORTIE" },
  { name: "Achat urgent", description: "Médicaments ou consommables en urgence", flow: "SORTIE" },
  { name: "Achat pharmacie", description: "Achat de médicaments sur facture fournisseur", flow: "SORTIE" },
  { name: "Fournitures médicales", description: "Gants, seringues, compresses, consommables", flow: "SORTIE" },
  { name: "Électricité / Eau", description: "Factures d'électricité, d'eau, internet", flow: "SORTIE" },
  { name: "Carburant générateur", description: "Carburant pour groupe électrogène", flow: "SORTIE" },
  { name: "Restauration", description: "Repas, boissons, collation du personnel", flow: "SORTIE" },
  { name: "Avance sur salaire", description: "Avance accordée à un employé", flow: "SORTIE" },
  { name: "Frais divers", description: "Autres sorties de caisse", flow: "SORTIE" },
  { name: "Approvisionnement caisse", description: "Fonds ajoutés à la caisse", flow: "ENTREE" },
  { name: "Remboursement reçu", description: "Remboursement d'une avance ou d'un fournisseur", flow: "ENTREE" },
  { name: "Apport de la direction", description: "Apport d'argent par l'administration", flow: "ENTREE" },
  { name: "Autre entrée", description: "Autres entrées de caisse", flow: "ENTREE" },
] as const;
