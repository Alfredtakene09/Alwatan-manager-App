const base = process.env.API_BASE ?? "http://127.0.0.1:4000/api";

async function tryLogin(username: string, password: string) {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    user?: { role?: string };
  };
  console.log(
    `${username.padEnd(28)} -> ${res.status} ${json.error ?? json.user?.role ?? "ok"}`,
  );
}

console.log("=== Case-insensitive username ===");
await tryLogin("Root", "root@Alwatan2026");
await tryLogin("root", "root@Alwatan2026");
await tryLogin("ROOT", "root@Alwatan2026");

console.log("=== Login via email ===");
await tryLogin("root@alwatan.local", "root@Alwatan2026");
await tryLogin("ROOT@ALWATAN.LOCAL", "root@Alwatan2026");

console.log("=== Wrong password still rejected ===");
await tryLogin("root", "bad-password");
