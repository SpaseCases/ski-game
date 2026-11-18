# Leaderboard Worker

A Cloudflare Worker between the game and Firestore. It's the only way into the
leaderboard database: the game calls this Worker, and the Worker calls
Firestore as a Google service account. `firestore.rules` shuts out everyone
else. The Worker checks every request (boards, ranges, the name and its word
filter, the look's shape and sizes), keeps entries from ever getting worse, and
limits how fast one address can read and write.

Code: `src/index.ts` (routes and checks, the daily cron), `src/market.ts` (the
marketplace, milestone 24: sharing, browsing with a minute's cache, Use,
reports, the developer's removals), `src/firestore.ts` (Firestore over REST,
the service account's token), `src/store.ts` (the store interface, and a
memory store for local play-tests), `src/http.ts` (shared bits). It shares
`src/online/limits.ts`, `src/online/marketRules.ts` and
`src/core/playerName.ts` with the game.

## Run it locally

```bash
cd worker
npm install
npm run dev
```

It listens on http://localhost:8787 with an in-memory store (no Google key
needed, emptied on restart) and allows any `http://localhost:*` page. The game's
dev server already points there (`.env.development`). Open the game with
`?boards=test`.

The marketplace's removals need a developer code. Locally it comes from
`worker/.dev.vars` (gitignored), one line: `DEV_CODE=` and any throwaway code.
Never put the real code there. Its rate limits are real locally too (120
writes a minute per address). `--var MARKET_MEMORY:off` turns the memory cache
off, to see the Cache API answer (the `X-Market-Cache` header).

## Going live (one time, in this order)

Each step changes something live, so do them yourself. Never paste a key into a
chat, a commit or a file in the repo.

1. **Cloudflare account.** Sign up at https://dash.cloudflare.com (free), then
   in this folder run `npx wrangler login`.
2. **Google service account.** In https://console.cloud.google.com, project
   `parklaps-3b60f`: *IAM & Admin → Service Accounts → Create service account*,
   named e.g. `leaderboard-worker`, with the role **Cloud Datastore User**. Then
   open it, *Keys → Add key → JSON*. The browser downloads a `.json` file. Keep it
   outside the repo.
3. **Give the Worker the key.** From this folder:
   `npx wrangler secret put GCP_SERVICE_ACCOUNT < path/to/the-key.json`
   (Cloudflare stores it encrypted; then delete the downloaded file.)
4. **Deploy.** `npm run deploy`. Wrangler prints the address,
   `https://parklaps-api.<your-subdomain>.workers.dev`.
5. **Check it.** Open
   `https://parklaps-api.<your-subdomain>.workers.dev/v1/top?set=live&board=park`
   in a browser. It should list the current Park board.
6. **Point the game at it.** Put the address in the repo's `.env.production`
   (`VITE_API_URL=https://parklaps-api.<your-subdomain>.workers.dev`), commit
   and push. The deploy workflow builds the game with it.
7. **Lock the database.** Once the live game shows its boards through the
   Worker, from the repo root: `firebase deploy --only firestore:rules`.

If the Worker is down or blocked, the game still plays, and the boards say
"Leaderboard offline".

## The marketplace (milestone 24; each step changes the live game, so ask first)

1. **The developer's code.** From this folder:
   `npx wrangler secret put DEV_CODE` and type a long code (16+ characters).
   It never goes in the repo or a chat. Type the same code in the game's dev
   box under your nickname on the title.
2. **The nickname's hash.** In your own terminal at the repo root:
   `node tools/dev/devHash.ts --write`, then commit `src/core/devUnlock.ts`.
3. **Redeploy** (`npm run deploy`): the marketplace routes, the `DEV` rate
   limit and the daily cron (`triggers` in `wrangler.jsonc`).
4. **The indexes.** From the repo root:
   `firebase deploy --only firestore:indexes` (the browse orders need them; they
   take a few minutes to build, and until then the Market says offline).
5. **Check** with `node tools/dev/devHash.ts --check` that neither the
   nickname nor the code is in the repo or `dist/`.

## Changing it later

- A new board (a map or a Slalom course): add it to `src/online/limits.ts` and
  `src/online/boards.ts`, then redeploy the Worker as well as the game.
- A new ski or board type, a changed paint grid, or a color added to the
  editor palette: update `src/online/marketRules.ts` (the game's dev build
  logs a mismatch), then redeploy the Worker.
- Allowed pages: `ALLOWED_ORIGINS` in `wrangler.jsonc` (a custom domain for the
  game must be added there).
- Rate limits: `ratelimits` in `wrangler.jsonc`. A whole classroom shares one
  address, so keep them loose.
- After editing `wrangler.jsonc`, run `npm run types` and commit
  `worker-configuration.d.ts`.
