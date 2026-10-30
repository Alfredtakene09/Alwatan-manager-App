import { prisma } from "./db.js";

/**
 * Traduction du journal d'audit pour un utilisateur non technicien :
 * une phrase qui dit ce qui a été fait, et les informations saisies avec
 * des libellés en français, des montants en FCFA et des noms à la place des identifiants.
 */

export type AuditDetailField = { label: string; value: string };
export type AuditDetailGroup = { label: string; columns: string[]; rows: string[][] };
export type AuditReadableDetails = { fields: AuditDetailField[]; groups: AuditDetailGroup[] };

/* ------------------------------------------------------------------ */
/* Phrase décrivant l'action                                           */
/* ------------------------------------------------------------------ */

/** Libellés des actions par route : « METHODE /chemin » avec [^/]+ pour les paramètres. */
const ROUTE_LABELS: Array<[string, string]> = [
  ["POST /auth/login", "Connexion à l'application"],
  ["POST /auth/logout", "Déconnexion de l'application"],
  ["PATCH /auth/password", "Changement de son mot de passe"],
  ["PATCH /auth/profile", "Modification de son profil"],

  ["POST /patients", "Enregistrement d'un nouveau patient"],
  ["PATCH /patients/:id", "Modification de la fiche d'un patient"],
  ["DELETE /patients/:id", "Suppression d'un patient"],
  ["PATCH /patients/:id/active", "Activation / désactivation d'un patient"],
  ["PATCH /patients/:id/discount", "Modification de la réduction d'un patient"],
  ["POST /patient-dossiers/:id/reconsult", "Nouvelle consultation d'un patient déjà suivi"],

  ["POST /visits", "Enregistrement d'une visite (passage du patient)"],
  ["PATCH /visits/:id/start-consultation", "Début de la consultation d'un patient"],
  ["PATCH /visits/:id/transfer", "Transfert d'un patient vers un autre service"],
  ["POST /visits/external-lab-order", "Demande d'examens de laboratoire pour un patient externe"],
  ["POST /visits/external-patient", "Enregistrement d'un patient externe"],

  ["POST /consultations", "Enregistrement d'une consultation"],
  ["POST /consultations/prescribe-exams", "Prescription d'examens"],
  ["PATCH /consultations/labs-resultats/:id/panels/:id/comment", "Commentaire sur un résultat de laboratoire"],

  ["POST /comptabilite", "Encaissement à la comptabilité"],
  ["POST /comptabilite/exam-reclamations", "Réclamation sur un examen payé"],
  ["PATCH /comptabilite/exam-reclamations/:id", "Traitement d'une réclamation d'examen"],
  ["DELETE /comptabilite/paid-exams/:id", "Annulation d'un examen payé"],
  ["POST /comptabilite/exam-types/catalog/:id", "Ajout d'un examen au catalogue"],
  ["PUT /comptabilite/exam-types/catalog/:id/:id", "Modification d'un examen du catalogue"],
  ["DELETE /comptabilite/exam-types/catalog/:id/:id", "Suppression d'un examen du catalogue"],
  ["POST /comptabilite/exam-types/operations", "Ajout d'un type d'opération"],
  ["PUT /comptabilite/exam-types/operations/:id", "Modification d'un type d'opération"],
  ["DELETE /comptabilite/exam-types/operations/:id", "Suppression d'un type d'opération"],
  ["POST /comptabilite/exam-types/service-tabs/:id", "Ajout d'un onglet de service au catalogue"],
  ["DELETE /comptabilite/exam-types/service-tabs/:id/:id", "Retrait d'un onglet de service du catalogue"],

  ["POST /pharmacie", "Vente de médicaments à la pharmacie"],
  ["POST /pharmacie/purchases", "Ajout de produits par facture fournisseur"],
  ["POST /pharmacie/products", "Ajout d'un produit à la pharmacie"],
  ["PUT /pharmacie/products/:id", "Modification d'un produit de la pharmacie"],
  ["DELETE /pharmacie/products/:id", "Suppression d'un produit de la pharmacie"],
  ["POST /pharmacie/products/:id/retire-expired", "Retrait d'un produit expiré"],
  ["POST /pharmacie/products/remove-expired", "Retrait de tous les produits expirés"],
  ["POST /pharmacie/stock-movements", "Mouvement de stock de la pharmacie"],
  ["PATCH /pharmacie/sales/:id", "Modification d'une vente de la pharmacie"],
  ["POST /pharmacie/sales/:id/returns", "Retour de médicaments vendus"],
  ["POST /pharmacie/day-closure", "Clôture de la journée de la pharmacie"],
  ["POST /pharmacie/suppliers", "Ajout d'un fournisseur de la pharmacie"],
  ["PUT /pharmacie/suppliers/:id", "Modification d'un fournisseur de la pharmacie"],
  ["DELETE /pharmacie/suppliers/:id", "Suppression d'un fournisseur de la pharmacie"],
  ["POST /pharmacie/categories", "Ajout d'une catégorie de produits"],
  ["PUT /pharmacie/categories/:id", "Modification d'une catégorie de produits"],
  ["DELETE /pharmacie/categories/:id", "Suppression d'une catégorie de produits"],
  ["POST /pharmacie/forms", "Ajout d'une forme de médicament"],
  ["PUT /pharmacie/forms/:id", "Modification d'une forme de médicament"],
  ["DELETE /pharmacie/forms/:id", "Suppression d'une forme de médicament"],
  ["POST /pharmacie/external-clients", "Ajout d'un client externe de la pharmacie"],
  ["PUT /pharmacie/external-clients/:id", "Modification d'un client externe de la pharmacie"],
  ["DELETE /pharmacie/external-clients/:id", "Suppression d'un client externe de la pharmacie"],

  ["POST /cash-desk/expenses", "Enregistrement d'une dépense ou entrée de caisse"],
  ["PUT /cash-desk/expenses/:id", "Modification d'une dépense de caisse"],
  ["DELETE /cash-desk/expenses/:id", "Suppression d'une dépense de caisse"],
  ["PATCH /cash-desk/expenses/:id/deactivate", "Annulation d'une dépense de caisse"],
  ["POST /cash-desk/day-closure", "Clôture de la journée de caisse"],
  ["POST /cash-desk/expense-indices", "Ajout d'un motif de dépense"],
  ["PUT /cash-desk/expense-indices/:id", "Modification d'un motif de dépense"],
  ["DELETE /cash-desk/expense-indices/:id", "Suppression d'un motif de dépense"],
  ["POST /cash-settlements", "Versement de caisse"],
  ["POST /cash-settlements/disburse", "Remise d'argent depuis la caisse"],

  ["POST /admin/expenses", "Enregistrement d'une dépense"],
  ["PUT /admin/expenses/:id", "Modification d'une dépense"],
  ["DELETE /admin/expenses/:id", "Suppression d'une dépense"],
  ["PATCH /admin/expenses/:id/validate", "Validation d'une dépense"],
  ["PATCH /admin/expenses/:id/reject", "Rejet d'une dépense"],
  ["POST /gestionnaire/expenses", "Enregistrement d'une dépense"],
  ["PUT /gestionnaire/expenses/:id", "Modification d'une dépense"],
  ["DELETE /gestionnaire/expenses/:id", "Suppression d'une dépense"],
  ["PATCH /gestionnaire/expenses/:id/validate", "Validation d'une dépense"],
  ["PATCH /gestionnaire/expenses/:id/reject", "Rejet d'une dépense"],
  ["POST /gestionnaire/expense-categories", "Ajout d'une catégorie de dépenses"],
  ["PUT /gestionnaire/expense-categories/:id", "Modification d'une catégorie de dépenses"],
  ["DELETE /gestionnaire/expense-categories/:id", "Suppression d'une catégorie de dépenses"],
  ["PATCH /gestionnaire/expense-categories/:id/archive", "Archivage d'une catégorie de dépenses"],

  ["POST /(admin|gestionnaire)/employees", "Ajout d'un employé"],
  ["PUT /(admin|gestionnaire)/employees/:id", "Modification de la fiche d'un employé"],
  ["DELETE /(admin|gestionnaire)/employees/:id", "Suppression d'un employé"],
  ["POST /(admin|gestionnaire)/job-titles", "Ajout d'un poste"],
  ["PUT /(admin|gestionnaire)/job-titles/:id", "Modification d'un poste"],
  ["DELETE /(admin|gestionnaire)/job-titles/:id", "Suppression d'un poste"],
  ["POST /(admin|gestionnaire)/job-titles/sync", "Mise à jour de la liste des postes"],
  ["POST /(admin|gestionnaire)/payroll/:id/pay", "Paiement d'un salaire"],
  ["POST /(admin|gestionnaire)/payroll/:id/cancel", "Annulation d'un paiement de salaire"],
  ["POST /gestionnaire/payroll/prepare", "Préparation de la paie du mois"],
  ["POST /gestionnaire/payroll/unprepare", "Annulation de la préparation de la paie"],
  ["POST /(admin|gestionnaire)/salary-advances", "Avance sur salaire"],
  ["DELETE /(admin|gestionnaire)/salary-advances/:id", "Suppression d'une avance sur salaire"],
  ["PATCH /(admin|gestionnaire)/salary-advances/:id/cancel", "Annulation d'une avance sur salaire"],
  ["POST /(admin|gestionnaire)/services", "Ajout d'un service de la clinique"],
  ["PUT /(admin|gestionnaire)/services/:id", "Modification d'un service de la clinique"],
  ["DELETE /(admin|gestionnaire)/services/:id", "Suppression d'un service de la clinique"],
  ["POST /admin/users", "Création d'un compte utilisateur"],
  ["PUT /admin/users/:id", "Modification d'un compte utilisateur"],
  ["DELETE /admin/users/:id", "Suppression d'un compte utilisateur"],
  ["PUT /admin/ui-permissions", "Modification des droits d'accès par rôle"],
  ["POST /admin/interventions", "Ajout d'un type d'intervention"],
  ["PUT /admin/interventions/:id", "Modification d'un type d'intervention"],
  ["POST /admin/products", "Ajout d'un produit"],
  ["PUT /admin/products/:id", "Modification d'un produit"],
  ["POST /admin/rooms", "Ajout d'une salle"],
  ["PUT /admin/rooms/:id", "Modification d'une salle"],
  ["PUT /clinic-info", "Modification des informations de la clinique"],

  ["POST /hospitalisation/actions", "Action sur une hospitalisation"],
  ["POST /hospitalisation/rooms", "Ajout d'une chambre d'hospitalisation"],
  ["PUT /hospitalisation/rooms/:id", "Modification d'une chambre d'hospitalisation"],
  ["DELETE /hospitalisation/rooms/:id", "Suppression d'une chambre d'hospitalisation"],

  ["DELETE /surgeries/:id", "Suppression d'une opération"],
  ["PATCH /surgeries/:id/billing", "Modification de la facturation d'une opération"],
  ["POST /surgeries/:id/complete", "Opération marquée comme terminée"],
  ["POST /surgeries/:id/pay-shares", "Paiement des parts d'une opération"],
  ["POST /surgeries/:id/revert", "Annulation du statut d'une opération"],
  ["POST /surgeries/:id/schedule", "Programmation d'une opération"],
  ["PATCH /surgeries/other-operations/:id/billing", "Modification de la facturation d'une opération"],
  ["DELETE /surgeries/other-operations/:id", "Suppression d'une opération"],
  ["POST /surgeries/pay-shares-batch", "Paiement groupé des parts d'opérations"],
  ["POST /doctor-overtime", "Enregistrement d'une garde de médecin"],
  ["POST /doctor-shares/:id/reject", "Rejet d'une part de médecin"],
  ["POST /doctor-shares/request-payroll", "Demande de paiement des parts de médecin"],
  ["POST /doctor-shares/settle-consultations-cash", "Paiement en espèces des parts de consultation"],

  ["POST /laboratoire/visits/:id/complete", "Résultats de laboratoire terminés"],
  ["PUT /laboratoire/visits/:id/panels/:id", "Saisie de résultats de laboratoire"],
  ["POST /lab-panels", "Ajout d'un bilan de laboratoire"],
  ["PUT /lab-panels/:id", "Modification d'un bilan de laboratoire"],
  ["DELETE /lab-panels/:id", "Suppression d'un bilan de laboratoire"],
  ["POST /lab-stock/items", "Ajout d'un article au stock du laboratoire"],
  ["PUT /lab-stock/items/:id", "Modification d'un article du stock du laboratoire"],
  ["DELETE /lab-stock/items/:id", "Suppression d'un article du stock du laboratoire"],
  ["POST /lab-stock/categories", "Ajout d'une catégorie du stock du laboratoire"],
  ["PUT /lab-stock/categories/:id", "Modification d'une catégorie du stock du laboratoire"],
  ["DELETE /lab-stock/categories/:id", "Suppression d'une catégorie du stock du laboratoire"],
  ["POST /lab-stock/stock-movements", "Mouvement de stock du laboratoire"],
  ["POST /consultation/exam-nomenclature", "Ajout d'un examen à la nomenclature"],
  ["PUT /consultation/exam-nomenclature/:id", "Modification d'un examen de la nomenclature"],
  ["DELETE /consultation/exam-nomenclature/:id", "Suppression d'un examen de la nomenclature"],
  ["POST /consultation/operation-types", "Ajout d'un type d'opération"],
  ["PUT /consultation/operation-types/:id", "Modification d'un type d'opération"],
  ["DELETE /consultation/operation-types/:id", "Suppression d'un type d'opération"],

  ["POST /logistique/items", "Ajout d'un article en logistique"],
  ["PUT /logistique/items/:id", "Modification d'un article en logistique"],
  ["DELETE /logistique/items/:id", "Suppression d'un article en logistique"],
  ["POST /logistique/categories", "Ajout d'une catégorie en logistique"],
  ["PUT /logistique/categories/:id", "Modification d'une catégorie en logistique"],
  ["DELETE /logistique/categories/:id", "Suppression d'une catégorie en logistique"],
  ["POST /logistique/suppliers", "Ajout d'un fournisseur en logistique"],
  ["PUT /logistique/suppliers/:id", "Modification d'un fournisseur en logistique"],
  ["DELETE /logistique/suppliers/:id", "Suppression d'un fournisseur en logistique"],
  ["POST /logistique/requests", "Demande de matériel en logistique"],
  ["POST /logistique/requests/:id/fulfill", "Demande de matériel servie"],
  ["POST /logistique/requests/:id/reject", "Demande de matériel refusée"],
  ["POST /logistique/stock-movements", "Mouvement de stock en logistique"],
];

const COMPILED_ROUTES = ROUTE_LABELS.map(([pattern, label]) => {
  const [method, path] = pattern.split(" ");
  const source = path.replace(/:id/g, "[^/]+");
  return { method, regex: new RegExp(`^${source}/?$`), label };
});

/** Actions enregistrées directement par l'application (hors requêtes HTTP). */
const BUSINESS_ACTION_LABELS: Record<string, string> = {
  "CREATE PharmacyPurchase": "Ajout de produits par facture fournisseur",
  "CREATE ClinicExpense": "Enregistrement d'une dépense",
  "RECEPTION_DAY_CLOSURE ReceptionDayClosure": "Clôture de la journée de la réception",
  "PAY EmployeePayroll": "Paiement d'un salaire",
  "CANCEL_PAY EmployeePayroll": "Annulation d'un paiement de salaire",
  "CLOSE PharmacyDayClosure": "Clôture de la journée de la pharmacie",
  "EXAM_RECLAMATION_REFUNDED ExamReclamation": "Remboursement d'une réclamation d'examen",
};

const GENERIC_VERBS: Record<string, string> = {
  POST: "Création",
  PUT: "Modification",
  PATCH: "Modification",
  DELETE: "Suppression",
};

export function describeAuditAction(input: {
  method: string | null;
  path: string | null;
  action: string;
  entity: string;
  moduleLabel: string;
}): string {
  if (input.method && input.path) {
    const path = input.path.replace(/^\/api/, "");
    const match = COMPILED_ROUTES.find((row) => row.method === input.method && row.regex.test(path));
    if (match) return match.label;
    return `${GENERIC_VERBS[input.method] ?? "Action"} — ${input.moduleLabel}`;
  }
  return BUSINESS_ACTION_LABELS[`${input.action} ${input.entity}`] ?? `${input.action} — ${input.moduleLabel}`;
}

/** Résultat d'une requête expliqué simplement. */
export function describeAuditResult(status: number | null, success: boolean): string {
  if (success) return "Réussi";
  switch (status) {
    case 400:
      return "Échec — informations incomplètes ou invalides";
    case 401:
      return "Échec — identifiant ou mot de passe incorrect, ou session expirée";
    case 403:
      return "Échec — l'utilisateur n'a pas le droit de faire cette action";
    case 404:
      return "Échec — élément introuvable (déjà supprimé ?)";
    case 409:
      return "Échec — l'élément existe déjà ou est utilisé ailleurs";
    default:
      return status && status >= 500 ? "Échec — erreur du serveur" : "Échec";
  }
}

/* ------------------------------------------------------------------ */
/* Informations saisies                                                */
/* ------------------------------------------------------------------ */

const FIELD_LABELS: Record<string, string> = {
  lines: "Produits",
  items: "Articles",
  quantity: "Quantité",
  purchasePriceFcfa: "Prix d'achat",
  unitPriceFcfa: "Prix de vente",
  unitCostFcfa: "Coût unitaire",
  sachetPriceFcfa: "Prix du sachet",
  sachetsPerBox: "Sachets par boîte",
  sellBySachet: "Vente au détail",
  sellByDetail: "Vente au détail",
  amountFcfa: "Montant",
  totalFcfa: "Total",
  priceFcfa: "Prix",
  feeFcfa: "Tarif",
  discountPercent: "Réduction (%)",
  businessDate: "Date",
  invoiceNumber: "N° de facture",
  expiryDate: "Date d'expiration",
  noExpiry: "Sans date d'expiration",
  newProduct: "Nouveau produit",
  name: "Nom",
  label: "Libellé",
  description: "Description",
  comment: "Commentaire",
  notes: "Notes",
  reason: "Motif",
  rejectionReason: "Motif du rejet",
  firstName: "Prénom",
  lastName: "Nom",
  phone: "Téléphone",
  email: "E-mail",
  username: "Identifiant",
  role: "Rôle",
  age: "Âge",
  ageUnit: "Unité d'âge",
  gender: "Sexe",
  address: "Adresse",
  dosage: "Dosage",
  pharmaceuticalForm: "Forme",
  sku: "Code produit",
  barcode: "Code-barres",
  minStock: "Stock minimum",
  type: "Type",
  flow: "Type de mouvement",
  category: "Catégorie",
  status: "Statut",
  active: "Actif",
  beneficiary: "Bénéficiaire",
  paymentMethod: "Mode de paiement",
  reference: "Référence",
  targetQuantity: "Nouvelle quantité",
  month: "Mois",
  year: "Année",
  grossFcfa: "Salaire brut",
  hiddenByRole: "Éléments masqués par rôle",
  login: "Identifiant",
  createdAt: "Créé le",
  code: "Code",
  service: "Service",
  recommendedByName: "Recommandé par",
  invoiceType: "Type de facture",
  paidAt: "Payé le",
  paidFcfa: "Montant payé",
  netTotalFcfa: "Total net",
  grossTotalFcfa: "Total brut",
  validatedAt: "Validé le",
  startedAt: "Commencé le",
  completedAt: "Terminé le",
  stockAfter: "Stock après",
  birthDate: "Date de naissance",
  profession: "Profession",
  clinicalNotes: "Notes cliniques",
  diagnosis: "Diagnostic",
};

/** Objet désigné par un champ « …Id » (pour le libellé du champ). */
const ID_FIELD_LABELS: Record<string, string> = {
  productId: "Produit",
  supplierId: "Fournisseur",
  patientId: "Patient",
  externalClientId: "Client externe",
  categoryId: "Catégorie",
  indiceId: "Motif de dépense",
  expenseCategoryId: "Catégorie de dépense",
  userId: "Utilisateur",
  doctorId: "Médecin",
  pharmacistId: "Pharmacien",
  anesthetistId: "Anesthésiste",
  employeeId: "Employé",
  serviceId: "Service",
  clinicServiceId: "Service",
  visitId: "Visite",
  roomId: "Chambre / salle",
  bedId: "Lit",
  itemId: "Article",
  prescriptionId: "Vente",
  jobTitleId: "Poste",
  paidById: "Payé par",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrateur",
  GESTIONNAIRE: "Gestionnaire",
  MEDECIN: "Médecin",
  PHARMACIEN: "Pharmacien",
  GESTIONNAIRE_PHARMACIE: "Gestionnaire pharmacie",
  RECEPTIONNISTE: "Réceptionniste",
  COMPTABLE: "Comptable",
  LABORANTIN: "Laborantin",
};

const VALUE_LABELS: Record<string, string> = {
  SORTIE: "Sortie (dépense)",
  ENTREE: "Entrée d'argent",
  ENTRY: "Entrée en stock",
  EXIT: "Sortie de stock",
  ADJUSTMENT: "Correction du stock",
  M: "Masculin",
  F: "Féminin",
  YEARS: "ans",
  MONTHS: "mois",
  DAYS: "jours",
  CASH: "Espèces",
  MOBILE_MONEY: "Mobile money",
  PENDING: "En attente",
  VALIDATED: "Validée",
  REJECTED: "Rejetée",
  ...ROLE_LABELS,
};

const ID_VALUE = /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

/** « purchasePriceFcfa » → « Purchase price » quand le champ n'a pas de libellé connu. */
function humanizeKey(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (ID_FIELD_LABELS[key]) return ID_FIELD_LABELS[key];
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  const words = key
    .replace(/(Fcfa|Id)$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

function formatAmount(value: number) {
  return `${value.toLocaleString("fr-FR").replace(/ /g, " ")} FCFA`;
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

type NameLookup = Map<string, string>;

function formatValue(key: string, value: unknown, names: NameLookup): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return /Fcfa$/.test(key) ? formatAmount(value) : value.toLocaleString("fr-FR");
  if (typeof value === "string") {
    if (value === "***") return "(masqué)";
    if (ID_VALUE.test(value)) return names.get(value) ?? "(élément supprimé ou introuvable)";
    if (ISO_DATE.test(value)) return formatDate(value);
    return VALUE_LABELS[value] ?? value;
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => formatValue(key, item, names)).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([inner, innerValue]) => {
        const text = formatValue(inner, innerValue, names);
        return text ? `${humanizeKey(inner)} : ${text}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  return String(value);
}

function isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item && typeof item === "object" && !Array.isArray(item));
}

/**
 * Valeurs lisibles d'une ligne (produit d'une facture, article d'une vente…).
 * Un « nouveau produit » s'affiche dans la même colonne qu'un produit existant.
 */
function readableLine(line: Record<string, unknown>, names: NameLookup) {
  const display: Record<string, string> = {};
  for (const [key, value] of Object.entries(line)) {
    if (key === "newProduct") {
      if (value && typeof value === "object") {
        const product = value as Record<string, unknown>;
        display.productId = `${[product.name, product.dosage].filter(Boolean).join(" ")} (nouveau produit)`;
      } else if (value) {
        // Anciennes entrées : le détail du nouveau produit n'était pas conservé.
        display.productId = "Nouveau produit";
      }
      continue;
    }
    if (key === "noExpiry" && value === false) continue;
    const text = formatValue(key, value, names);
    if (text && !display[key]) display[key] = text;
  }
  return display;
}

export function readableAuditDetails(body: unknown, names: NameLookup): AuditReadableDetails {
  const fields: AuditDetailField[] = [];
  const groups: AuditDetailGroup[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return { fields, groups };

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === "_note") {
      fields.push({ label: "Remarque", value: String(value) });
      continue;
    }
    if (isRecordArray(value)) {
      const rows = value.map((line) => readableLine(line, names));
      const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      // Le produit (ou l'élément) en première colonne.
      keys.sort((x, y) => Number(y === "productId") - Number(x === "productId"));
      groups.push({
        label: `${humanizeKey(key)} (${value.length})`,
        columns: keys.map(humanizeKey),
        rows: rows.map((row) => keys.map((k) => row[k] ?? "—")),
      });
      continue;
    }
    const text = formatValue(key, value, names);
    if (text) fields.push({ label: humanizeKey(key), value: text });
  }
  return { fields, groups };
}

/* ------------------------------------------------------------------ */
/* Noms à la place des identifiants                                    */
/* ------------------------------------------------------------------ */

export function collectAuditIds(value: unknown, into: Set<string>) {
  if (typeof value === "string") {
    if (ID_VALUE.test(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) value.forEach((item) => collectAuditIds(item, into));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectAuditIds(item, into));
}

const fullName = (row: { firstName: string; lastName: string }) => `${row.firstName} ${row.lastName}`.trim();

/**
 * Cherche les identifiants dans les tables qui ont un nom affichable.
 * Les identifiants (cuid) sont uniques dans toute la base : une recherche par table suffit.
 */
export async function resolveAuditNames(ids: Set<string>): Promise<NameLookup> {
  const names: NameLookup = new Map();
  if (!ids.size) return names;
  const idList = [...ids];
  const where = { id: { in: idList } };

  const lookups: Array<Promise<Array<[string, string]>>> = [
    prisma.product.findMany({ where, select: { id: true, name: true, dosage: true } })
      .then((rows) => rows.map((r) => [r.id, r.dosage ? `${r.name} ${r.dosage}` : r.name])),
    prisma.pharmacySupplier.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.patient.findMany({ where, select: { id: true, code: true, firstName: true, lastName: true } })
      .then((rows) => rows.map((r) => [r.id, `${fullName(r)} (${r.code})`])),
    prisma.user.findMany({ where, select: { id: true, firstName: true, lastName: true } })
      .then((rows) => rows.map((r) => [r.id, fullName(r)])),
    prisma.employee.findMany({ where, select: { id: true, firstName: true, lastName: true } })
      .then((rows) => rows.map((r) => [r.id, fullName(r)])),
    prisma.pharmacyExternalClient.findMany({ where, select: { id: true, code: true, firstName: true, lastName: true } })
      .then((rows) => rows.map((r) => [r.id, `${fullName(r)} (${r.code})`])),
    prisma.productCategory.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.productForm.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.clinicService.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.clinicExpenseIndice.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.expenseCategory.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.clinicExpense.findMany({ where, select: { id: true, label: true } })
      .then((rows) => rows.map((r) => [r.id, r.label])),
    prisma.employeeJobTitle.findMany({ where, select: { id: true, label: true } })
      .then((rows) => rows.map((r) => [r.id, r.label])),
    prisma.room.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.bed.findMany({ where, select: { id: true, code: true, label: true } })
      .then((rows) => rows.map((r) => [r.id, r.label ?? r.code])),
    prisma.examCatalogItem.findMany({ where, select: { id: true, label: true } })
      .then((rows) => rows.map((r) => [r.id, r.label])),
    prisma.interventionType.findMany({ where, select: { id: true, label: true } })
      .then((rows) => rows.map((r) => [r.id, r.label])),
    prisma.labPanel.findMany({ where, select: { id: true, label: true } })
      .then((rows) => rows.map((r) => [r.id, r.label])),
    prisma.labStockItem.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.labStockCategory.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.logisticsItem.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.logisticsCategory.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.logisticsSupplier.findMany({ where, select: { id: true, name: true } })
      .then((rows) => rows.map((r) => [r.id, r.name])),
    prisma.invoice.findMany({ where, select: { id: true, invoiceNumber: true } })
      .then((rows) => rows.map((r) => [r.id, `Facture n° ${r.invoiceNumber}`])),
    prisma.visit.findMany({ where, select: { id: true, patient: { select: { firstName: true, lastName: true, code: true } } } })
      .then((rows) => rows.map((r) => [r.id, r.patient ? `Visite de ${fullName(r.patient)} (${r.patient.code})` : "Visite"])),
  ];

  for (const pairs of await Promise.all(lookups)) {
    for (const [id, name] of pairs) names.set(id, name);
  }
  return names;
}
