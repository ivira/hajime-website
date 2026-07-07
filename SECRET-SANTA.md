# Secret Santa — one-time strategy-session game

A private, unlisted page that runs a Secret Santa draw for the executive team
and collects everyone's funny-t-shirt size.

- **Page:** `/secret-santa.html` (not linked from the site, `noindex`)
- **Backend:** a small Cloudflare Worker (`worker/index.js`) using one KV
  namespace to store t-shirt sizes.

## How it works

1. Each person opens the link, selects their name, and picks a t-shirt
   size + fit (and an optional note).
2. The page reveals **who they are the Secret Santa for**, and shows that
   person's t-shirt size once they've entered it.
3. A progress bar shows how many of the 8 players have chosen a size.

Assignments are computed **server-side** from a secret seed in
`worker/index.js`. No browser ever receives the full mapping, so nobody can
peek at who gives to whom — each player only ever sees their own recipient.
The draw is a single ring, so no one is ever assigned themselves.

**Players (8):** Vira Tkachenko, Andrii Pynda, Dmytro Melnyk, Grant Belair,
Katerina Zlenko, Oleksandr Kosovan, Альона Мороз, Лілія Мудрик.
(Alyona Tymoshenko is excluded.)

## One-time setup

From the repo root:

```bash
# 1. Create the KV namespace
npx wrangler kv namespace create SANTA
```

Copy the returned `id` into `wrangler.jsonc`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`:

```jsonc
"kv_namespaces": [
  { "binding": "SANTA", "id": "abc123…the-id-you-got…" }
]
```

```bash
# 2. Deploy
npx wrangler deploy
```

Then share the link: `https://<your-domain>/secret-santa.html`

> If the site auto-deploys from GitHub (Cloudflare Workers Builds), you still
> need to create the KV namespace once and commit the real id into
> `wrangler.jsonc` before the deploy will succeed.

## Test locally

```bash
npx wrangler dev
# open the printed URL + /secret-santa.html
```

`wrangler dev` uses a local KV by default, so you can click through the whole
flow without touching production data.

## Reset / play again

The game is designed to be played once. To wipe all chosen sizes and start
over, delete the stored keys:

```bash
npx wrangler kv key list --binding SANTA        # see stored keys (player:*)
# delete each, or just delete & recreate the namespace
```

Changing `SEED` in `worker/index.js` reshuffles the whole draw — only do that
before anyone starts playing.
