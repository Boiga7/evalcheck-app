# Privacy policy — evalcheck GitHub App

Last updated: 2026-04-29

## Summary

The evalcheck GitHub App is **stateless**. We do not run a database. We do not write log files containing customer data. We do not share any data with third parties beyond the GitHub API (whose calls we make on your behalf, with credentials GitHub minted for your specific installation).

## What we receive

When you install the App on a repository and a workflow run completes, GitHub sends a webhook event containing:

- Repository owner and name
- Commit SHA and branch name
- Associated pull request numbers
- Workflow run ID
- Installation ID

In response, the App calls the GitHub API to:

- Download the `evalcheck-results` artifact your CI uploaded
- Read `.evalcheck/snapshots/baseline.json` from the PR's base branch
- Post or update a comment on the pull request
- Set a Check Run on the head commit
- (For paid plans) Read the active GitHub Marketplace plan attached to the installation

## What's in the results artifact

The artifact contains test IDs, metric names, scores (floats between 0 and 1), thresholds, and timestamps. It does **not** contain prompts, model outputs, retrieval contexts, expected answers, or any other content the test produced — those live only inside your test code on your CI runner and never reach the App.

## What we store

Nothing. The App processes each webhook in isolation and forgets it. Vercel may retain function invocation logs for diagnostic purposes per their own retention policy; those logs include the source IP, request timing, and HTTP status, but no body content.

## Marketplace billing

If you subscribe via GitHub Marketplace, GitHub processes the payment and informs us of the plan name and billing cycle via webhook. We do not see card numbers. Stripe Connect handles the underlying transaction.

## Source code

The App is open source — https://github.com/Boiga7/evalcheck-app — under the MIT licence. Anyone can audit exactly what the webhook handler does.

## Contact

Questions about this policy: open an issue at https://github.com/Boiga7/evalcheck-app/issues.
