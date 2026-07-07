// Secret Santa backend for the executive strategy session.
// Runs as a Cloudflare Worker in front of the static site.
//
// Only /api/santa/* requests are handled here; everything else is served
// straight from the static assets (the main Hajime website is untouched).
//
// Assignments are derived deterministically on the server from a secret
// seed, so:
//   * they are stable (the game is played exactly once),
//   * they need no storage and can never race, and
//   * no browser is ever sent the full giver -> receiver mapping —
//     each player only learns who *they* are gifting.
//
// KV (binding SANTA) stores only each player's chosen t-shirt size.

const PLAYERS = [
  { id: "vira", name: "Vira Tkachenko" },
  { id: "andrii", name: "Andrii Pynda" },
  { id: "dmytro", name: "Dmytro Melnyk" },
  { id: "grant", name: "Grant Belair" },
  { id: "katerina", name: "Katerina Zlenko" },
  { id: "oleksandr", name: "Oleksandr Kosovan" },
  { id: "alyona-moroz", name: "Альона Мороз" },
  { id: "liliia", name: "Лілія Мудрик" },
];

// Server-only secret. Do not expose to clients. Changing this reshuffles
// the whole draw, so leave it alone once people start playing.
const SEED = "hajime-strategy-secret-santa-2026-7f3a9c2e";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];
const FITS = ["Unisex", "Fitted"];

const byId = new Map(PLAYERS.map((p) => [p.id, p]));

// Stable per-player rank from SHA-256(seed|id) — hex of the first 8 bytes.
async function rankOf(id) {
  const data = new TextEncoder().encode(SEED + "|" + id);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// Order all players into a single ring, then each gives to the next one.
// A ring is always a valid derangement: nobody is ever assigned themselves.
async function ringOrder() {
  const ranked = await Promise.all(
    PLAYERS.map(async (p) => ({ p, r: await rankOf(p.id) }))
  );
  ranked.sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));
  return ranked.map((x) => x.p);
}

async function recipientOf(playerId) {
  const order = await ringOrder();
  const i = order.findIndex((p) => p.id === playerId);
  if (i === -1) return null;
  return order[(i + 1) % order.length];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readEntry(env, id) {
  const raw = await env.SANTA.get("player:" + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Public-facing state for one player: who they gift + that person's size.
async function stateFor(env, playerId) {
  const me = byId.get(playerId);
  if (!me) return null;
  const recipient = await recipientOf(playerId);
  const myEntry = await readEntry(env, playerId);
  const recEntry = await readEntry(env, recipient.id);
  return {
    you: { id: me.id, name: me.name },
    yourEntry: myEntry, // {size, fit, note} or null
    recipient: { name: recipient.name },
    recipientEntry: recEntry, // {size, fit, note} or null
  };
}

// Progress board — names + whether each has chosen a size.
// Deliberately reveals NOTHING about who gifts whom.
async function progress(env) {
  const rows = await Promise.all(
    PLAYERS.map(async (p) => ({
      name: p.name,
      done: (await env.SANTA.get("player:" + p.id)) !== null,
    }))
  );
  return {
    total: PLAYERS.length,
    done: rows.filter((r) => r.done).length,
    players: rows,
  };
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/santa/players" && request.method === "GET") {
    return json({
      players: PLAYERS.map((p) => ({ id: p.id, name: p.name })),
      sizes: SIZES,
      fits: FITS,
    });
  }

  if (path === "/api/santa/progress" && request.method === "GET") {
    return json(await progress(env));
  }

  if (path === "/api/santa/state" && request.method === "GET") {
    const id = url.searchParams.get("player") || "";
    const state = await stateFor(env, id);
    if (!state) return json({ error: "unknown_player" }, 400);
    return json(state);
  }

  if (path === "/api/santa/size" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad_json" }, 400);
    }
    const id = String(body.player || "");
    if (!byId.has(id)) return json({ error: "unknown_player" }, 400);

    const size = String(body.size || "");
    if (!SIZES.includes(size)) return json({ error: "bad_size" }, 400);

    let fit = String(body.fit || "Unisex");
    if (!FITS.includes(fit)) fit = "Unisex";

    const note = String(body.note || "").trim().slice(0, 200);

    await env.SANTA.put(
      "player:" + id,
      JSON.stringify({ size, fit, note, name: byId.get(id).name })
    );

    const state = await stateFor(env, id);
    return json(state);
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    // Everything else: serve the static site unchanged.
    return env.ASSETS.fetch(request);
  },
};
