import { InterventionCategory, type Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Acte saisi dans les champs (pas un tarif officiel du catalogue imprimé). */
export function isRememberedManualOperationCode(code: string) {
  const value = code.trim().toUpperCase();
  if (value.startsWith("OPM-")) return true;
  const last = value.split("-").pop() ?? "";
  return value.startsWith("OP-") && last.length >= 6 && /\d/.test(last);
}

export function manualOperationCode(label: string) {
  const slug = label
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18);
  return `OPM-${slug || "ACTE"}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Enregistre le nom et le prix saisis comme opération du service.
 * Un tarif officiel déjà présent sur ce service n'est pas écrasé.
 * Retourne null si le libellé est seulement le nom du service (prix libre sans acte).
 */
export async function rememberManualServiceOperation(
  tx: Tx,
  input: {
    label: string;
    clinicServiceId: string;
    amountFcfa: number;
    surgeonPercent: number;
    surgeonId?: string | null;
  },
) {
  const label = input.label.trim();
  const clinicServiceId = input.clinicServiceId.trim();
  const amountFcfa = Math.max(0, Math.round(input.amountFcfa));
  if (!label || !clinicServiceId) return null;

  const service = await tx.clinicService.findFirst({
    where: { id: clinicServiceId, active: true },
    select: { id: true, name: true },
  });
  if (!service) return null;
  if (service.name.trim().toLowerCase() === label.toLowerCase()) return null;

  const existing = await tx.interventionType.findFirst({
    where: { label, active: true, clinicServiceId: service.id },
  });
  if (existing) {
    if (
      amountFcfa > 0 &&
      amountFcfa !== existing.totalCostFcfa &&
      isRememberedManualOperationCode(existing.code)
    ) {
      return tx.interventionType.update({
        where: { id: existing.id },
        data: { totalCostFcfa: amountFcfa },
      });
    }
    return existing;
  }
  if (amountFcfa <= 0) return null;

  const surgeonPercent = Math.min(99, Math.max(1, Math.round(input.surgeonPercent || 70)));
  return tx.interventionType.create({
    data: {
      code: manualOperationCode(label),
      label,
      category: InterventionCategory.MOYENNE_B,
      totalCostFcfa: amountFcfa,
      surgeonPercent,
      anesthesiologistPercent: 0,
      clinicServiceId: service.id,
      surgeonId: input.surgeonId ?? null,
      active: true,
    },
  });
}
