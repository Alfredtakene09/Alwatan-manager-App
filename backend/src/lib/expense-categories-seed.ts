export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Fournitures", icon: "package", color: "#2563eb", sortOrder: 0 },
  { name: "Équipements", icon: "monitor", color: "#d97706", sortOrder: 1 },
  { name: "Maintenance", icon: "wrench", color: "#0d9488", sortOrder: 2 },
  { name: "Carburant", icon: "fuel", color: "#64748b", sortOrder: 3 },
  { name: "Alimentation", icon: "utensils", color: "#7c3aed", sortOrder: 4 },
  { name: "Frais divers", icon: "receipt", color: "#94a3b8", sortOrder: 5 },
  { name: "Autre", icon: "circle-ellipsis", color: "#475569", sortOrder: 6 },
] as const;
