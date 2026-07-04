import { prisma } from "./db.js";

export async function generatePharmacyExternalClientCode() {
  const year = new Date().getFullYear();
  const prefix = `CLI-PH-${year}-`;
  const last = await prisma.pharmacyExternalClient.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const lastSequence = last ? Number.parseInt(last.code.split("-")[3] ?? "0", 10) : 0;
  return `${prefix}${String(lastSequence + 1).padStart(4, "0")}`;
}

export function splitPharmacyExternalClientName(fullName: string) {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) throw new Error("INVALID_EXTERNAL_NAME");
  const space = trimmed.indexOf(" ");
  if (space === -1) {
    return { firstName: trimmed, lastName: trimmed };
  }
  const lastName = trimmed.slice(space + 1).trim();
  return {
    firstName: trimmed.slice(0, space),
    lastName: lastName.length >= 2 ? lastName : trimmed,
  };
}
