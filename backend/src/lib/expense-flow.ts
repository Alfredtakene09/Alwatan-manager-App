import { ClinicExpenseCategory, ClinicExpenseFlow } from "@prisma/client";
import { prisma } from "./db.js";

/** Code comptable déduit du nom d'indice indiqué dans le formulaire. */
export function categoryFromIndiceName(name: string): ClinicExpenseCategory {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.includes("transport")) return ClinicExpenseCategory.TRANSPORT;
  if (normalized.includes("maintenance")) return ClinicExpenseCategory.MAINTENANCE;
  if (normalized.includes("urgent") || normalized.includes("equipement")) {
    return ClinicExpenseCategory.ACHAT_URGENT;
  }
  if (
    normalized.includes("fourniture") ||
    normalized.includes("entretien") ||
    normalized.includes("papier")
  ) {
    return ClinicExpenseCategory.FOURNITURES;
  }
  return ClinicExpenseCategory.AUTRE;
}

export function isCashEntry(flow: ClinicExpenseFlow | null | undefined) {
  return flow === ClinicExpenseFlow.ENTREE;
}

/** Solde = encaissements + entrées − sorties. */
export function netAfterCashMovements(
  collectedFcfa: number,
  outflowFcfa: number,
  inflowFcfa = 0,
) {
  return Math.max(0, collectedFcfa + inflowFcfa - outflowFcfa);
}

export async function resolveExpenseClassification(input: {
  indiceId?: string | null;
  category?: ClinicExpenseCategory | null;
  flow?: ClinicExpenseFlow | null;
  allowInactive?: boolean;
}) {
  const flow = input.flow === ClinicExpenseFlow.ENTREE
    ? ClinicExpenseFlow.ENTREE
    : ClinicExpenseFlow.SORTIE;

  if (!input.indiceId) {
    return {
      flow,
      indiceId: null as string | null,
      category: input.category ?? ClinicExpenseCategory.AUTRE,
    };
  }

  const indice = await prisma.clinicExpenseIndice.findUnique({
    where: { id: input.indiceId },
  });
  if (!indice || (!indice.active && !input.allowInactive)) {
    throw new Error("INDICE_INVALID");
  }

  const category =
    input.category && input.category !== ClinicExpenseCategory.AUTRE
      ? input.category
      : categoryFromIndiceName(indice.name);

  return {
    flow: indice.flow,
    indiceId: indice.id,
    category,
  };
}
