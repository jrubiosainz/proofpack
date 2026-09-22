# Contributing

Use Node.js 22 or later. `npm ci` needs no third-party package downloads.

```sh
npm ci
npm run check
npm test
npm run demo
```

Keep changes focused and describe the product behavior they affect. For UI changes, run `npm start`, inspect the three workflow steps in a normal browser, and check keyboard navigation and a narrow viewport. Example data and screenshots must remain explicitly synthetic.

Requirements live in `samples/requirements.json`; the executable registry and pre-call guards are in `src/scope.mjs`. A new check needs a real verifier, linked cases and regression tests. Do not loosen existing checks to obtain a pass. Keep stale scope, unknown/empty criteria, exact citations, malformed support routes and read-only protocol behavior covered.

Do not commit `.env`, generated `.proofpack/` or `dist/`, credentials, operator logs, personal data or account identifiers. Do not add automatic cloud calls to ordinary development commands. Azure execution is an explicit operator action, separate from contribution checks.

The project currently has no open-source license grant. Discuss licensing or dependency changes with the repository owner before adding external code or assets.
