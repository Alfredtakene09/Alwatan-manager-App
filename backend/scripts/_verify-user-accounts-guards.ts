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

async function api(jar: Jar, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  parseSetCookie(res.headers.getSetCookie?.() ?? [], jar);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const jar: Jar = new Map();
  const login = await api(jar, "POST", "/auth/login", {
    username: "Root",
    password: "root@Alwatan2026",
  });
  assert(login.status === 200, `login failed: ${login.status}`);
  console.log("OK login Admin");

  const list = await api(jar, "GET", "/admin/users");
  assert(list.status === 200, `list failed: ${list.status}`);
  const users = list.json as Array<{
    id: string;
    username: string;
    role: string;
    active: boolean;
  }>;
  assert(Array.isArray(users) && users.length > 0, "empty user list");
  assert(
    users.some((u) => u.role === "ADMIN"),
    "ADMIN accounts missing from list",
  );
  console.log(`OK list (${users.length} users, includes ADMIN)`);

  const me =
    users.find((u) => u.username === "Root") ??
    users.find((u) => u.role === "ADMIN");
  assert(Boolean(me), "admin account not found");

  const detail = await api(jar, "GET", `/admin/users/${me!.id}`);
  assert(detail.status === 200, `detail failed: ${detail.status}`);
  console.log("OK GET /admin/users/:id");

  const selfDeact = await api(jar, "PUT", `/admin/users/${me!.id}`, {
    active: false,
  });
  assert(selfDeact.status === 409, `self deactivate expected 409 got ${selfDeact.status}`);
  console.log("OK cannot deactivate own account");

  const selfDel = await api(jar, "DELETE", `/admin/users/${me!.id}`);
  assert(selfDel.status === 409, `self delete expected 409 got ${selfDel.status}`);
  console.log("OK cannot delete own account");

  const demote = await api(jar, "PUT", `/admin/users/${me!.id}`, {
    role: "COMPTABLE",
  });
  assert(demote.status === 409, `last admin demote expected 409 got ${demote.status}`);
  console.log("OK cannot demote last active admin");

  const anon = await api(new Map(), "GET", "/admin/users");
  assert(anon.status === 401, `anon expected 401 got ${anon.status}`);
  console.log("OK unauthenticated → 401");

  console.log("\nALL GUARD CHECKS PASSED");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
