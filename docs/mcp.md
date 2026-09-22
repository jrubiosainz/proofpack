# Read-only MCP context

The optional adapter exposes the synthetic workflow through **local stdio MCP**. It is not an inference server and cannot approve scope, execute a run, open arbitrary files or send tickets. An MCP client is not required for the web demo.

For clients that accept an `mcpServers` configuration map, use this entry after replacing the example path with your local checkout. Point the client directly at Node so npm startup text does not enter the protocol stream.

```json
{
  "mcpServers": {
    "proofpack": {
      "command": "node",
      "args": ["/absolute/path/to/proofpack/src/mcp.mjs"]
    }
  }
}
```

The source path is resolved relative to the module, not the client's working directory. Do not pass Azure credentials to this adapter.

| Tool | Arguments | Result |
| --- | --- | --- |
| `proofpack_get_briefing` | `{}` | Synthetic example and data boundaries |
| `proofpack_get_acceptance` | `{"stage":"initial"}`, `{"stage":"changed"}` or `{"stage":"validated"}` | Recomputed scope gate |
| `proofpack_get_evidence` | `{}` | Current synthetic fixture report |

Resources are `proofpack://briefing`, `proofpack://acceptance/changed` and `proofpack://evidence/latest`. Tools advertise read-only, non-destructive, idempotent and closed-world annotations. Unknown tools, resources, stages and extra arguments are rejected.

The implementation supports initialize, ping, tools/list, tools/call, resources/list and resources/read using newline-delimited JSON-RPC. It negotiates protocol versions `2024-11-05`, `2025-03-26` or `2025-06-18`; diagnostics go to stderr, not stdout. It is a deliberately small adapter, not a complete MCP SDK.

`npm test` includes a real stdio initialization/list/call exchange. Client configuration formats vary: use your client's local MCP settings. GitHub Copilot App may be used independently to coordinate development and review; no client-specific integration is embedded in ProofPack.
