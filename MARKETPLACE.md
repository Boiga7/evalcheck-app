# Listing evalcheck on GitHub Marketplace

The App code already handles `marketplace_purchase` webhooks and queries plan status per workflow run (see `src/api.ts::getInstallationPlan` and `src/orchestrator.ts`). The remaining work is on the GitHub side — only you can do it from your account.

## Reality check before you start

- Listing review takes **2–4 weeks** for a verified publisher decision.
- GitHub takes **25%** of revenue.
- Your account currently has zero contribution history. New accounts publishing paid Marketplace listings get extra scrutiny. **Don't submit until you have at least 50 free-tier installs and a few outside contributions visible on your profile** — otherwise the review will probably bounce.
- The App must be **paid-only or freemium** to list as paid. Free-only listings don't go through Marketplace; they're discoverable via the App's regular install URL.

If you're impatient, the freemium GitHub App route (this) is still the lowest-friction billing path. Stripe direct gives you 100% of revenue but adds 2 weeks of integration work.

## Order of operations

### Phase 1 — Make the App publishable as a Marketplace listing

This phase doesn't list anything; it puts the App into a state where you *can* submit.

1. Go to https://github.com/settings/apps and click **evalcheck**.
2. In the left sidebar click **Public page**, then click the **List on Marketplace** button when it appears (sometimes nested under "Advanced").
3. Fill the listing form:
   - **Tagline:** `PR comments for LLM eval regressions`
   - **Description:** copy from the README's "The pitch" section, ~300 words.
   - **Categories:** "Code quality" + "Continuous integration".
   - **Logo:** any 200x200 PNG. Skip if you don't have one — the default placeholder is fine for a v1 listing.
   - **Primary product type:** GitHub App.

4. Add new event subscription on the App (left sidebar → **Permissions & events**):
   - Tick **Marketplace purchase** under "Subscribe to events".
   - Save changes.

   The App webhook handler at `api/webhook.ts` already has a branch for this event — it acknowledges 200 and logs the action. We don't currently store anything from it (we re-query the plan per workflow_run instead) but adding the subscription is required for Marketplace to consider the App "purchase-aware".

### Phase 2 — Configure pricing plans

Still on the App's Marketplace listing page:

1. Click **New plan** and create two:

   **Free plan:**
   - Name: `Free`
   - Description: `Public repos and the first 50 evals per private-repo run.`
   - Monthly price: `$0`
   - Yearly price: `$0`
   - Features:
     - Unlimited public repos
     - Up to 50 evals per private-repo run
     - PR comments + GitHub Check status
   - Bullets (these surface in the Marketplace UI): keep short.

   **Pro plan:**
   - Name: `Pro`
   - Description: `Unlimited private-repo evals.`
   - Monthly price: `$19` per unit
   - Yearly price: `$190` per unit (~17% off)
   - Unit type: per repo
   - Features:
     - Everything in Free
     - Unlimited evals per private-repo run
     - Priority support (email)
     - Hosted dashboard tier when it ships

2. Save plans.

### Phase 3 — Set up payouts

Marketplace requires a payment account before paid plans can go live.

1. Same page, scroll to **Payouts**.
2. GitHub uses Stripe Connect. Click **Set up payouts** and follow Stripe's onboarding (bank details, tax info — about 10 minutes).
3. **Important:** UK-based publishers need to enter VAT details if applicable. Below the £85k turnover threshold this is straightforward; above it consult an accountant.

### Phase 4 — Submit for verification + listing approval

1. Same page, click **Request verification**.
2. GitHub's reviewer will check:
   - The App actually does what the listing claims.
   - The Free tier delivers genuine value (not bait-and-switch).
   - Documentation links work (README, support email, privacy policy).
   - You have a recognisable presence — Boiga7 currently has no contribution history outside this account; expect questions.

3. Wait. Reviews take 2–4 weeks. They'll either approve, ask questions, or reject with reasons.

4. While waiting, **keep building free-tier installs** — Marketplace approval looks at install count, and "0 installs" with "we want to charge" is the worst possible signal.

## Phase 5 — When the listing is live

Flip the billing gate on:

```bash
cd Startups/evalcheck-app
vercel env add ENABLE_BILLING_GATE production
# When prompted, type: true
vercel --prod
```

After the deploy, private-repo runs above 50 evals will return a neutral check pointing users to upgrade at `https://github.com/marketplace/evalcheck`. Public-repo runs and small private-repo runs are unaffected.

## What the App code already handles

- `src/api.ts::getInstallationPlan` — queries `/marketplace_listing/installation/{id}/plan`, returns null when the App isn't a paid listing yet.
- `src/orchestrator.ts` — gates private-repo runs above the cap when `ENABLE_BILLING_GATE=true`.
- `api/webhook.ts` — accepts `marketplace_purchase` events and returns 200.

No DB, no KV, no separate billing service. GitHub holds the source of truth and we re-query when we need it.

## Likely rejection reasons + fixes

| Reason | Fix |
|---|---|
| "App doesn't have enough installs to demonstrate fit" | Get 50+ free installs first, then re-submit. |
| "Free tier is too restrictive" | Bump the cap to 100 evals/run, or make the cap on something else (number of repos, number of judges). |
| "Privacy policy missing" | Add a `PRIVACY.md` to the repo and link it from the listing. |
| "Verified publisher requires more profile depth" | Submit a few PRs to other repos, get a few stars on this one, retry in a month. |
| "Marketplace listings cannot reference competitor products" | Trim the comparison links if they push back. Some reviewers care, some don't. |

## What this earns

Realistic month-12 outcomes for a side-project SaaS at this shape:

- **Pessimistic:** 5 paid installs, $95/month gross, $71/month after 25% cut. Hobby money.
- **Realistic:** 30 paid installs, $570/month gross, $427/month net. Pays for the AWS hobby budget.
- **Lucky break:** 200 paid installs, $3,800/month gross, $2,850/month net. Real side income but you'll be on call for support.

The kind of thing that makes the lucky break happen: a single well-known engineer tweets about it after merging the LangChain cookbook PR. Distribution dominates outcome.
