/**
 * Vérification Phase 3 — gestion des comptes (Admin / user-accounts).
 * Usage : backend démarré sur PORT (défaut 4000) + base accessible.
 *   npx tsx scripts/test-user-accounts-api.ts
 */
const base = process.env.API_BASE ?? "http://127.0.0.1:4000/api";

type Jar = Map<string, string>;

function parseSetCookie(headers: string[] | undefined, jar: Jar) {
  if (!headers) return;
  for (const line of headers) {
    const part = line.split(";")[0]?.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

function cookieHeader(jar: Jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function api(
  jar: Jar,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; setCookie?: string[] }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  parseSetCookie(setCookie.length ? setCookie : undefined, jar);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, setCookie };
}

async function login(jar: Jar, username: string, password: string) {
  const r = await api(jar, "POST", "/auth/login", { username, password });
  if (r.status !== 200) throw new Error(`Login ${username} failed: ${r.status} ${JSON.stringify(r.json)}`);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const adminJar: Jar = new Map();
  await login(adminJar, "Root", "root@Alwatan2026");

  const list = await api(adminJar, "GET", "/admin/users");
  assert(list.status === 200, `Admin GET /admin/users expected 200 got ${list.status}`);
  const users = list.json as { role: string; username: string }[];
  assert(Array.isArray(users), "users list must be array");
  assert(users.some((u) => u.role === "ADMIN"), "Admin users must include ADMIN role accounts");

  const guestJar: Jar = new Map();
  try {
    await login(guestJar, "Root", "wrong-password");
  } catch {
    /* ignore */
  }

  console.log("OK: admin list includes ADMIN accounts");

  console.log("\nTests manuels restants (comptes Direction / métiers) :");
  console.log("  - Connexion COMPTABLE → GET /admin/users → 403");
  console.log("  - Désactivation compte → requête authentifiée suivante → 401");
  console.log("  - Dernier admin actif → PUT active:false → 409");
}

main().catch((e) => {
  console.error("FAIL:", e.message ?? e);
  process.exit(1);
});
