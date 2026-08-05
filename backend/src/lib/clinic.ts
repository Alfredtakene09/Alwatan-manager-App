import { prisma } from "./db.js";

export const CLINIC_INFO_ID = "default";

/** Valeurs d’usine — seed + fallback hors DB. */
export const DEFAULT_CLINIC = {
  nameFr: "Clinique Alwatan pour la médecine moderne",
  nameAr: "مستوصف الوطن الطبي",
  shortName: "Al-Watan",
  logo: "/logo-alwatan.jpeg",
  city: "Abéché, Tchad",
  address: "Kamina I Avenue Maréchal IDRISS DEBY ITNO",
  fullAddress: "Abéché, Tchad, Kamina I Avenue Maréchal IDRISS DEBY ITNO",
  phones: "+235 93 93 86 51 – 63 01 94 22",
  phoneLabel: "Tel : +235 93 93 86 51 – 63 01 94 22",
  email: "cabinetmedicalalwatan@gmail.com",
  nif: "",
  rc: "",
  printFooter: "",
} as const;

export type ClinicInfoData = {
  [K in keyof typeof DEFAULT_CLINIC]: string;
};

let runtimeClinic: ClinicInfoData = { ...DEFAULT_CLINIC };
let cachedAt = 0;
const CACHE_TTL_MS = 15_000;

function normalizeClinic(row: Partial<ClinicInfoData> | null | undefined): ClinicInfoData {
  const phones = String(row?.phones ?? DEFAULT_CLINIC.phones).trim() || DEFAULT_CLINIC.phones;
  const city = String(row?.city ?? DEFAULT_CLINIC.city).trim() || DEFAULT_CLINIC.city;
  const address = String(row?.address ?? DEFAULT_CLINIC.address).trim() || DEFAULT_CLINIC.address;
  const fullAddress =
    String(row?.fullAddress ?? "").trim() ||
    [city, address].filter(Boolean).join(", ") ||
    DEFAULT_CLINIC.fullAddress;
  const phoneLabel =
    String(row?.phoneLabel ?? "").trim() || `Tel : ${phones}` || DEFAULT_CLINIC.phoneLabel;

  return {
    nameFr: String(row?.nameFr ?? DEFAULT_CLINIC.nameFr).trim() || DEFAULT_CLINIC.nameFr,
    nameAr: String(row?.nameAr ?? DEFAULT_CLINIC.nameAr).trim() || DEFAULT_CLINIC.nameAr,
    shortName: String(row?.shortName ?? DEFAULT_CLINIC.shortName).trim() || DEFAULT_CLINIC.shortName,
    logo: String(row?.logo ?? DEFAULT_CLINIC.logo).trim().split("?")[0] || DEFAULT_CLINIC.logo,
    city,
    address,
    fullAddress,
    phones,
    phoneLabel,
    email: String(row?.email ?? DEFAULT_CLINIC.email).trim() || DEFAULT_CLINIC.email,
    nif: String(row?.nif ?? "").trim(),
    rc: String(row?.rc ?? "").trim(),
    printFooter: String(row?.printFooter ?? "").trim(),
  };
}

/** Proxy sync — lit toujours le cache rafraîchi par `getClinicInfo()`. */
export const CLINIC: ClinicInfoData = new Proxy({} as ClinicInfoData, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== "string") return undefined;
    return runtimeClinic[prop as keyof ClinicInfoData];
  },
  ownKeys() {
    return Reflect.ownKeys(runtimeClinic);
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop !== "string" || !(prop in runtimeClinic)) return undefined;
    return {
      enumerable: true,
      configurable: true,
      value: runtimeClinic[prop as keyof ClinicInfoData],
    };
  },
});

export function clinicTaxLine(info: ClinicInfoData = runtimeClinic): string {
  const parts: string[] = [];
  if (info.nif) parts.push(`NIF : ${info.nif}`);
  if (info.rc) parts.push(`RC : ${info.rc}`);
  return parts.join(" · ");
}

export function serializeClinicInfo(info: ClinicInfoData = runtimeClinic) {
  return {
    ...info,
    taxLine: clinicTaxLine(info),
  };
}

export async function ensureClinicInfoRow(): Promise<ClinicInfoData> {
  const existing = await prisma.clinicInfo.findUnique({ where: { id: CLINIC_INFO_ID } });
  if (existing) {
    runtimeClinic = normalizeClinic(existing);
    cachedAt = Date.now();
    return runtimeClinic;
  }

  const created = await prisma.clinicInfo.create({
    data: {
      id: CLINIC_INFO_ID,
      ...DEFAULT_CLINIC,
    },
  });
  runtimeClinic = normalizeClinic(created);
  cachedAt = Date.now();
  return runtimeClinic;
}

export async function getClinicInfo(options?: { force?: boolean }): Promise<ClinicInfoData> {
  if (!options?.force && Date.now() - cachedAt < CACHE_TTL_MS && cachedAt > 0) {
    return runtimeClinic;
  }
  try {
    return await ensureClinicInfoRow();
  } catch {
    return runtimeClinic;
  }
}

export type ClinicInfoUpdateInput = Partial<ClinicInfoData>;

export async function updateClinicInfo(input: ClinicInfoUpdateInput): Promise<ClinicInfoData> {
  await ensureClinicInfoRow();
  const current = runtimeClinic;
  const next = normalizeClinic({
    ...current,
    ...input,
  });

  const updated = await prisma.clinicInfo.update({
    where: { id: CLINIC_INFO_ID },
    data: {
      nameFr: next.nameFr,
      nameAr: next.nameAr,
      shortName: next.shortName,
      logo: next.logo,
      city: next.city,
      address: next.address,
      fullAddress: next.fullAddress,
      phones: next.phones,
      phoneLabel: next.phoneLabel,
      email: next.email,
      nif: next.nif,
      rc: next.rc,
      printFooter: next.printFooter,
    },
  });

  runtimeClinic = normalizeClinic(updated);
  cachedAt = Date.now();
  return runtimeClinic;
}

export function invalidateClinicInfoCache() {
  cachedAt = 0;
}
