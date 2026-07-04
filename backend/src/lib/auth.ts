import { SignJWT, jwtVerify } from "jose";
import type { AppUserRole } from "./roles.js";

const COOKIE_NAME = "alwatan_session";

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: AppUserRole;
};

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET manquant");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, getSecret());
  return {
    id: String(payload.id),
    email: String(payload.email),
    firstName: String(payload.firstName),
    lastName: String(payload.lastName),
    role: payload.role as AppUserRole,
  };
}

export { COOKIE_NAME };
