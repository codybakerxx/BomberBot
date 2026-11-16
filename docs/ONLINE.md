# Putting BomberBot online

The plan (chosen November 2026): the game runs on **Cloudflare**. The game page is served as a static file by
Cloudflare Workers, and online play will run on Cloudflare too: one Durable Object per game room, running the
same rules (`sim.ts`) and CPU players (`bot.ts`) as the game on a phone, with every player connected to it over
a WebSocket. Cloudflare's free plan is enough to build and test on; the Workers Paid plan ($5 a month) is the
step up for regular play.

## How it gets there

Every push to `main` runs `.github/workflows/deploy.yml` on GitHub: it installs, runs `npm run check` and, if
the two secrets below are set, uploads with `wrangler deploy` (`wrangler.jsonc` says what to upload). The game
is then at `https://bomberbot.<the account's workers.dev subdomain>.workers.dev`.

Claude's sessions cannot reach Cloudflare directly, so GitHub does the upload.

## One-time setup (the owner)

1. In the Cloudflare dashboard, open **Workers & Pages** once, and pick the account's workers.dev subdomain
   if it asks.
2. **My Profile › API Tokens › Create Token**, use the **Edit Cloudflare Workers** template, keep the defaults
   (the account, all zones), create it, and copy the token. It is shown once.
3. Copy the **Account ID** (Workers & Pages overview, on the right; or the account's home page).
4. On GitHub, the BomberBot repository: **Settings › Secrets and variables › Actions › New repository
   secret**, twice: `CLOUDFLARE_API_TOKEN` with the token, `CLOUDFLARE_ACCOUNT_ID` with the Account ID.
5. **Actions › Deploy to Cloudflare › Run workflow** (or push anything to `main`).

Never paste the token into a chat, a file or a commit: it goes only into GitHub's secrets.
