<p align="center">
  <a href="https://i2v.ai">
    <img src="https://i2v.ai/brand/folded-rabbit-light.png" alt="i2v.ai" width="96">
  </a>
</p>

<h1 align="center">i2v.ai Agent Skills</h1>

<p align="center">
  Two first-party Skills that teach a coding agent how to discover, quote, generate and recover i2v.ai media tasks.<br>
  Works with Codex, Claude Code, Cursor, GitHub Copilot, Gemini CLI and other Skill-aware agents.
</p>

<p align="center">
  <a href="https://i2v.ai/cli"><img alt="Docs" src="https://img.shields.io/badge/docs-i2v.ai%2Fcli-6366f1?style=flat-square"></a>
  <a href="https://i2v.ai/.well-known/agent-skills/index.json"><img alt="Discovery index" src="https://img.shields.io/badge/index-agent--skills-0ea5e9?style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square"></a>
</p>

<br>

## Install

```bash
npx skills add https://i2v.ai --skill i2v-models
npx skills add https://i2v.ai --skill i2v-integrate
```

Or install from this repository:

```bash
npx skills add i2v-ai/i2v-skills --skill i2v-models i2v-integrate
```

## What each Skill covers

| Skill | Use it for |
| --- | --- |
| `i2v-models` | Discover image and video models, read parameter docs, quote inputs, submit inside a USD ceiling, poll, and recover a lost submission. Ships a bundled CLI so no global install is needed. |
| `i2v-integrate` | Backend and workflow integration: tenant ownership, budget checks, idempotency, signed webhooks, replay rules, and adapting the runnable examples to your project. |

Both Skills quote before spending. Paid tasks require an explicit `maxCostUsd`; a lost response is recovered with the original idempotency key instead of a new submission.

## Plugin manifests

This repository is also a portable Agent Plugin and a [CC] plugin:

- `plugin.json` and `mcp.json` for portable Agent Plugins
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `.mcp.json` for [CC]
- Remote MCP endpoint: `https://i2v.ai/api/mcp` (OAuth `mcp:read` / `mcp:write`)

## Validate

```bash
node scripts/check-manifests.mjs
```

## For AI agents

- Agent index: <https://i2v.ai/llms.txt>
- Skill discovery index: <https://i2v.ai/.well-known/agent-skills/index.json>
- Remote MCP server: <https://i2v.ai/api/mcp>

## Related repositories

| Repository | Purpose |
| --- | --- |
| [i2v-cli](https://github.com/i2v-ai/i2v-cli) | Command-line tools |
| [i2v-sdk-js](https://github.com/i2v-ai/i2v-sdk-js) | TypeScript SDK |
| [i2v-sdk-python](https://github.com/i2v-ai/i2v-sdk-python) | Python SDK |
| [i2v-mcp](https://github.com/i2v-ai/i2v-mcp) | Remote MCP metadata |
| [generate-action](https://github.com/i2v-ai/generate-action) | GitHub Action |
| [i2v-api-examples](https://github.com/i2v-ai/i2v-api-examples) | Runnable examples |
| [i2v-agent-tools](https://github.com/i2v-ai/i2v-agent-tools) | Ecosystem hub |

## License

MIT. See [LICENSE](./LICENSE).
