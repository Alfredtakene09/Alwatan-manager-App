/**
 * Banc de test d'intégration : base PostgreSQL dédiée « alwatan_test », recréée vide
 * à chaque lancement, serveur API lancé sur un port à part. La base de travail
 * (« alwatan ») n'est jamais ouverte par ces tests.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(__dirname, "../..");

export const TEST_DB_NAME = "alwatan_test";
export const TEST_PORT = Number(process.env.ALWATAN_TEST_PORT ?? 4100);
export const API = `http://127.0.0.1:${TEST_PORT}/api`;

/** Même serveur PostgreSQL que l'appli, autre base (nom forcé à « alwatan_test »). */
export function testDatabaseUrl() {
  const env = dotenv.parse(fs.readFileSync(path.join(backendRoot, ".env")));
  const url = new URL(env.DATABASE_URL);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

function adminUrl(testUrl: string) {
  const url = new URL(testUrl);
  url.pathname = "/postgres";
  url.search = "";
  return url.toString();
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(cmd, args, {
    cwd: backendRoot,
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} a échoué :\n${result.stdout}\n${result.stderr}`);
  }
}

/** Supprime puis recrée « alwatan_test », pousse le schéma et le seed de référence. */
export async function resetTestDatabase() {
  const url = testDatabaseUrl();
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("Base de test invalide");

  const admin = new PrismaClient({ datasourceUrl: adminUrl(url) });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } finally {
    await admin.$disconnect();
  }

  // Prisma CLI : une variable déjà définie l'emporte sur .env.
  run("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { DATABASE_URL: url });
  run("npx", ["tsx", "prisma/seed.ts"], { ALWATAN_TEST_DATABASE_URL: url });
  return url;
}

let server: ChildProcess | null = null;

export async function startTestServer(url: string) {
  server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: backendRoot,
    env: { ...process.env, ALWATAN_TEST_DATABASE_URL: url, ALWATAN_TEST_PORT: String(TEST_PORT) },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout?.on("data", (chunk) => (output += chunk));
  server.stderr?.on("data", (chunk) => (output += chunk));

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Le serveur de test ne démarre pas :\n${output.slice(-3000)}`);
}

export function stopTestServer() {
  if (!server?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
  server = null;
}

/** Client API avec cookie de session (une session par compte). */
export class ApiClient {
  private cookie = "";

  constructor(readonly label: string) {}

  async login(username: string, password: string) {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`Connexion ${this.label} refusée : ${res.status} ${await res.text()}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    this.cookie = setCookie.split(";")[0] ?? "";
    return this;
  }

  async request<T = any>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${API}${url}`, {
      method,
      headers: {
        Cookie: this.cookie,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* réponse non JSON */
    }
    return { status: res.status, data };
  }

  get<T = any>(url: string) {
    return this.request<T>("GET", url);
  }
  post<T = any>(url: string, body?: unknown) {
    return this.request<T>("POST", url, body ?? {});
  }
  patch<T = any>(url: string, body?: unknown) {
    return this.request<T>("PATCH", url, body ?? {});
  }
  delete<T = any>(url: string) {
    return this.request<T>("DELETE", url);
  }
}

export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
