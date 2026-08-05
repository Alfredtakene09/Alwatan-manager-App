import { randomUUID } from "crypto";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { AppUserRole } from "./roles.js";
import { SESSION_IDLE_MS } from "./session-security.js";

const COOKIE_NAME = "alwatan_session";

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: AppUserRole;
};

export type SessionClaims = SessionUser & {
  /** Identifiant unique de session (jti), une seule active par utilisateur. */
  sid: string;
};

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET manquant");
  return new TextEncoder().encode(secret);
}

export function sessionCookieOptions(req?: Request) {
  const envSecure = ["1", "true", "yes"].includes((process.env.COOKIE_SECURE ?? "").toLowerCase());
  // Sur HTTP LAN, ne jamais forcer Secure (sinon Edge/Chrome refuse le cookie → session perdue).
  const requestIsHttps = Boolean(req?.secure || req?.headers["x-forwarded-proto"] === "https");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: envSecure && requestIsHttps,
    path: "/",
    maxAge: SESSION_IDLE_MS,
  };
}

export function newSessionId() {
  return randomUUID();
}

export async function createSessionToken(user: SessionUser, sessionId: string) {
  return new SignJWT({
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    sid: sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(sessionId)
    .setExpirationTime(`${Math.floor(SESSION_IDLE_MS / 1000)}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, getSecret());
  const sid = String(payload.sid ?? payload.jti ?? "");
  if (!sid) {
    throw new Error("Session sans identifiant");
  }
  return {
    id: String(payload.id),
    username: String(payload.username ?? ""),
    email: String(payload.email),
    firstName: String(payload.firstName),
    lastName: String(payload.lastName),
    role: payload.role as AppUserRole,
    sid,
  };
}

export { COOKIE_NAME };
