# Deploying evalcheck-app

This walks you from "code in repo" to "live GitHub App posting PR comments" in roughly 15 minutes. Three logical phases:

1. Register a GitHub App (~5 min) — only the GitHub web UI can do this.
2. Deploy to Vercel (~5 min) — `vercel --prod` does the heavy lifting.
3. Wire the App to Vercel via webhook URL + secrets (~5 min).

## Phase 1 — Register the GitHub App

1. Go to https://github.com/settings/apps/new
2. Fill in:
   - **GitHub App name:** `evalcheck`
   - **Homepage URL:** `https://github.com/Boiga7/evalcheck`
   - **Webhook URL:** leave a placeholder for now (e.g. `https://example.com`). We'll come back.
   - **Webhook secret:** generate one (e.g. `openssl rand -hex 32`) and save it somewhere safe.
3. Under **Repository permissions**, set:
   - **Actions:** Read-only (to download artifacts)
   - **Checks:** Read and write
   - **Contents:** Read-only (to read baseline.json from the base branch)
   - **Issues:** Read and write (PR comments live on the issues endpoint)
   - **Pull requests:** Read and write
4. Under **Subscribe to events**, tick: **Workflow run**.
5. Where can this GitHub App be installed: **Any account**.
6. Click **Create GitHub App**.

After creation:
- Copy the **App ID** (numeric, top of the page).
- Click **Generate a private key**. A `.pem` file downloads. Keep it — you'll paste it into Vercel as an env var. **Do not commit it.**

## Phase 2 — Deploy to Vercel

```bash
cd Startups/evalcheck-app
npx vercel login          # one-time
npx vercel link           # creates the Vercel project; pick "no" to existing config
npx vercel env add GITHUB_APP_ID production
npx vercel env add GITHUB_APP_PRIVATE_KEY production    # paste the entire .pem contents
npx vercel env add GITHUB_WEBHOOK_SECRET production     # paste the webhook secret from Phase 1
npx vercel --prod
```

The last command prints the production URL. Copy it.

For local testing, repeat the `env add` commands with `development` instead of `production` and use `vercel dev`.

## Phase 3 — Wire up the webhook

1. Back at https://github.com/settings/apps, click your `evalcheck` app, then **Edit**.
2. **Webhook URL:** `https://YOUR-VERCEL-URL/api/webhook` (use the URL from Phase 2).
3. Save.
4. Click **Install App** in the left sidebar.
5. Pick **Boiga7/evalcheck** (the plugin repo) as the test installation. **Install**.

## Phase 4 — Verify end-to-end

1. In `Boiga7/evalcheck`, the existing CI workflow already runs on every push. We need it to upload the `evalcheck-results` artifact too. Add to `.github/workflows/ci.yml` (after the `Coverage` step):

```yaml
      - name: Run evalcheck (no-op for self-tests, but writes results)
        if: always()
        run: |
          mkdir -p .evalcheck
          # the plugin's own test suite doesn't actually invoke @eval at scale,
          # so for the self-test we just synthesise a results.json
          echo '{"schema_version":1,"runs":[]}' > .evalcheck/results.json
      - name: Upload evalcheck results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: evalcheck-results
          path: .evalcheck/results.json
```

   (For real consumer repos, the plugin auto-writes `results.json` during pytest. The user just adds the `actions/upload-artifact@v4` step.)

2. Open a PR with any change. Push.
3. Wait for CI to finish.
4. The webhook fires. Within ~30 seconds, the PR gets a comment from `evalcheck[bot]` and a check run appears.

## Troubleshooting

| Problem | Fix |
|---|---|
| Vercel deploy: "Cannot find module 'jszip'" | Make sure `package.json` is committed and `npm install` ran in CI. Vercel does this automatically on deploy. |
| Webhook fails with 401 "invalid signature" | The `GITHUB_WEBHOOK_SECRET` env var doesn't match the one in the GitHub App settings. Re-add. |
| Webhook fails with 500 "missing required env vars" | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, or `GITHUB_WEBHOOK_SECRET` not set on Vercel. `vercel env ls` to check. |
| `installation token request failed (404)` | App isn't installed on the repo. Repeat Phase 3 step 5. |
| PEM parse fails on Vercel | When pasting the private key, make sure newlines are preserved. Use `vercel env add` interactively (paste the whole file in), not via shell. |
| Comment never appears, no error | Check Vercel logs (`vercel logs`). Likely the artifact name doesn't match — must be `evalcheck-results`. |

## What this earns

- Free tier on Vercel covers ~100k invocations/month. Even at 100 active installs each pushing 50 PRs/day, we're well under that.
- No long-lived tokens — GitHub App auth uses short-lived JWTs minted from the private key per request.
- Comment is `upsert`-shaped: pushes to the same PR update one comment in place rather than spamming.
