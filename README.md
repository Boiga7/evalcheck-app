# evalcheck-app

The GitHub App half of [evalcheck](https://github.com/Boiga7/evalcheck).

When CI completes on a PR, this app downloads the `.evalcheck/results.json` artifact, diffs it against the `.evalcheck/snapshots/baseline.json` on the base branch, posts a markdown comment summarising regressions and improvements, and sets a GitHub Check status.

## What's in here

- `src/diff.ts` — pure function that compares two snapshot files
- `src/render.ts` — turns a diff into a markdown PR comment
- `src/auth.ts` — GitHub App JWT minting + installation token exchange
- `src/api.ts` — fetch wrappers for the GitHub REST endpoints we need
- `src/webhook.ts` — HMAC signature verification + event-type guards
- `src/orchestrator.ts` — wires it all together for `workflow_run.completed`
- `api/webhook.ts` — the Vercel function entry point

## Deploying

See `DEPLOY.md`.

## Tests

```bash
npm install
npm test
npm run typecheck
```

24 unit tests covering diff and render logic and webhook signature verification. Integration with the live GitHub API is exercised on Vercel preview deployments.

## License

MIT.
