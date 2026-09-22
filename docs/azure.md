# Optional bounded Azure execution

The offline product needs no cloud resources. Use this path only when you deliberately want to measure model **fact selection** on the synthetic cases, using your own authorized environment and budget. It has not been run as part of the included offline example.

## Prerequisites

Use Azure CLI with an authorized Entra login, your own subscription and tenant, and an existing resource group tagged `Product=ProofPack`. An Azure OpenAI-compatible account must disable local key authentication and contain a structured-output deployment compatible with the chat completions API and a 180-token output limit.

Copy the variable names from [`.env.example`](../.env.example) and **export your own values in your shell**. The application does not load `.env` automatically. Keep credentials and real identifiers out of committed files. The suggested resource-group name is `rg-proofpack`; explicitly choose your own group rather than reusing unrelated resources.

The selected deployment must use `Standard`, `DataZoneStandard` or `GlobalStandard` with capacity 1-10. Availability, quota, supported model versions, routing and charges depend on your account. There is no automatic region, model or SKU fallback.

## Run

Review and commit the executable source and synthetic inputs first. The live evaluator rejects a dirty checkout.

```sh
npm run azure:preflight
npm run scope:approve -- --scope v2
npm run evaluate:azure -- --scope v2
```

These commands require `PROOFPACK_ALLOW_AZURE=1` plus all the Azure values in `.env.example`. Preflight checks the explicitly selected subscription, tenant, tagged group, account and deployment. It makes Azure management reads, **not** model calls. Each CLI invocation specifies the subscription; no global account switch is made.

Scope approval is an **automated demo approval**, not human authorization. The evaluator validates criteria, all prompts, budgets and exact approval hashes **before** obtaining credentials or invoking the provider. A stale approval or unknown/empty criterion prevents all model calls.

Execution is serial and bounded: at most **4 call attempts**, **180 output tokens per call**, **7,000 serialized input characters per call**, a **30-second request timeout**, and **no automatic retries**. Token pricing still depends on the chosen model. The input-character cap is not an input-token measurement.

Only selections, rendered answers and compact usage/request receipts are saved in ignored `.proofpack/runs/`. Provider refusals are not completions and do not pass acceptance. No provider failure is replaced by a synthetic answer. The browser and MCP adapter continue to show the separate offline fixture, not your Azure report.

## Optional infrastructure template

[`infra/main.bicep`](../infra/main.bicep) describes a small account and model deployment in an explicitly selected resource group. Model name/version and account name are required parameters; the capacity default is 1. Nothing in `start`, `demo`, `build`, `test` or the evaluator provisions resources.

Before applying infrastructure, review a resource-group-scoped `az deployment group what-if` with your selected subscription, resource group and parameters. Choose current model availability yourself. Account-scoped operator role assignment is **off by default** (`assignOperatorRole=false`); request any necessary access through your normal process.

The template enables a public account endpoint with Entra authentication and disables local keys. Review network access and residency requirements for your environment before deployment. It does not change tenant policy or grant tenant-wide roles. Deployment region alone is not a processing-residency guarantee.

Human release review remains pending after a technical pass. Manage and remove only resources you explicitly created; there is no automatic deployment or cleanup command.
