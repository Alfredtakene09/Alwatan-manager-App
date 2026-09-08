import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 8;

const FORBIDDEN_PASSWORDS = new Set(
  [
    "Clinique2026!",
    "root@Alwatan2026",
    "Alwatan2026!",
    "password",
    "password123",
    "12345678",
    "admin",
    "alwatan",
  ].map((value) => value.toLowerCase()),
);

export function isForbiddenPassword(password: string) {
  return FORBIDDEN_PASSWORDS.has(password.trim().toLowerCase());
}

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`)
  .refine((value) => !isForbiddenPassword(value), {
    message: "Ce mot de passe est trop courant ou correspond à un mot de passe d'installation. Choisissez-en un autre.",
  });
