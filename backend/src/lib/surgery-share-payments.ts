import type { SurgeryCase } from "@prisma/client";

export type OperationShareKind = "surgeon" | "assistant" | "clinic";

export const SHARE_KIND_LABELS: Record<OperationShareKind, string> = {
  surgeon: "Médecin",
  assistant: "Assistant",
  clinic: "Clinique",
};

type SurgerySharePaymentFields = Pick<
  SurgeryCase,
  "surgeonPaidAt" | "assistantPaidAt" | "clinicPaidAt"
> & {
  interventionType?: { anesthesiologistPercent: number } | null;
};

export function surgeryHasAssistant(surgery: {
  interventionType?: { anesthesiologistPercent: number } | null;
}): boolean {
  return (surgery.interventionType?.anesthesiologistPercent ?? 0) > 0;
}

export function getApplicableShareKinds(surgery: {
  interventionType?: { anesthesiologistPercent: number } | null;
}): OperationShareKind[] {
  const kinds: OperationShareKind[] = ["surgeon"];
  if (surgeryHasAssistant(surgery)) {
    kinds.push("assistant");
  }
  kinds.push("clinic");
  return kinds;
}

export function isSharePaid(surgery: SurgerySharePaymentFields, kind: OperationShareKind): boolean {
  switch (kind) {
    case "surgeon":
      return Boolean(surgery.surgeonPaidAt);
    case "assistant":
      return Boolean(surgery.assistantPaidAt);
    case "clinic":
      return Boolean(surgery.clinicPaidAt);
  }
}

export function hasAnySharePaid(surgery: SurgerySharePaymentFields): boolean {
  return (
    isSharePaid(surgery, "surgeon") ||
    isSharePaid(surgery, "assistant") ||
    isSharePaid(surgery, "clinic")
  );
}

export function isFullyPaid(surgery: SurgerySharePaymentFields): boolean {
  return getApplicableShareKinds(surgery).every((kind) => isSharePaid(surgery, kind));
}

export function getUnpaidShareKinds(surgery: SurgerySharePaymentFields): OperationShareKind[] {
  return getApplicableShareKinds(surgery).filter((kind) => !isSharePaid(surgery, kind));
}

export function buildSharePaymentUpdate(
  surgery: SurgerySharePaymentFields,
  shares: OperationShareKind[],
  userId: string,
  now = new Date(),
) {
  const data: {
    surgeonPaidAt?: Date;
    surgeonPaidById?: string;
    assistantPaidAt?: Date;
    assistantPaidById?: string;
    clinicPaidAt?: Date;
    clinicPaidById?: string;
  } = {};

  for (const share of shares) {
    if (share === "assistant" && !surgeryHasAssistant(surgery)) {
      throw new Error("ASSISTANT_SHARE_NOT_APPLICABLE");
    }
    if (isSharePaid(surgery, share)) {
      throw new Error("SHARE_ALREADY_PAID");
    }

    if (share === "surgeon") {
      data.surgeonPaidAt = now;
      data.surgeonPaidById = userId;
    } else if (share === "assistant") {
      data.assistantPaidAt = now;
      data.assistantPaidById = userId;
    } else {
      data.clinicPaidAt = now;
      data.clinicPaidById = userId;
    }
  }

  return data;
}

export function clearSharePaymentFields() {
  return {
    surgeonPaidAt: null,
    surgeonPaidById: null,
    assistantPaidAt: null,
    assistantPaidById: null,
    clinicPaidAt: null,
    clinicPaidById: null,
  };
}
