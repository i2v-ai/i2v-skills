# i2v.ai CLI and MCP workflow

## Setup

- Connect the remote Streamable HTTP MCP server at `https://i2v.ai/api/mcp` through a client that supports its authentication. Read-only OAuth can discover models and return quotes. Task creation and upload need write authorization.
- For the bundled CLI, set `I2V_API_KEY` in the shell that starts the agent. In bash or zsh use `export I2V_API_KEY="YOUR_API_KEY"`. In PowerShell use `$env:I2V_API_KEY = "YOUR_API_KEY"`. Keep this value outside committed settings and logs.
- With a desktop client that launches stdio, run `node /absolute/path/to/i2v-cli.mjs mcp`. Provide the key through the client's environment. For local file operations set `I2V_WORKSPACE_DIR` to the specific project directory. Use placeholders in example client configs.
- Public CLI commands `list`, `doc` and `price` work without a key. `price` shows catalog rates and units. `quote` uses the actual account and inputs. `balance` returns available and reserved USD.

## Diagnosis and discovery

Use `node SCRIPT doctor --json` to check public discovery and, when a key is configured, MCP connectivity. Use `recommend` or `recommend_models` with output requirements and reference counts. For example, `node SCRIPT recommend --task image-to-video --input '{"aspectRatio":"9:16","duration":5,"referenceImages":1}' --json`. Recommendations describe capabilities and current observations. Confirm actual inputs with `plan` or `prepare_generation`.

## Each operation

Use `node SCRIPT doc MODEL --schema` for machine-readable constraints. Use `node SCRIPT doc MODEL --locale zh` for Chinese Markdown. For `plan`, supply exactly one of `--input`, `--input-file` and `--stdin` to quote or run. With input JSON files, store model parameters such as the prompt and reference URL directly in the object.

`run --no-wait` returns the task receipt as soon as available. Use `status TASK_ID --wait 120` to resume without a new charge. The default `run` wait is 300 seconds. When submitting a reviewed plan, include `--expected-revision` from its result. Recheck if the model revision changes. The CLI stores the operation key before submitting and updates the receipt when a task ID arrives. Receipts contain the model ID, endpoint, key, time and known task ID. Override the local directory with `I2V_STATE_DIR`. Use `recover KEY` with the same credential to look up the server receipt. A local wait ending does not cancel the remote task.

When polling receives a rate limit or temporary gateway failure, the CLI retries the same task within the requested wait and follows `Retry-After`. If the wait ends first, resume later with the same task ID.

## Account and connection checks

- `get_account` shows available and reserved USD, funding categories, and the connection scopes. `get_usage` reports charges, usage refunds, verified historical net usage and total net usage. It accepts `today`, `yesterday`, `7d`, `30d` or `90d`, and uses UTC booking dates. These are account totals across channels. For API keys, the REST equivalents are `GET /api/v1/account` and `GET /api/v1/account/usage?range=30d`.
- Local stdio checks for updates at MCP initialization and reports available versions to the host. `node SCRIPT doctor --json` compares the CLI and its adjacent installed Skill against the official release manifest. With `I2V_API_KEY` configured it also checks the MCP server version and tool list. For a GitHub install, refresh `i2v-models` with `npx skills update i2v-models`. For a website install, reinstall the version from `npx skills add https://i2v.ai --skill i2v-models` in the original install scope. Reconnect hosted MCP if the client keeps an older tool list. For local stdio, restart the host after replacing the CLI.
- A connection with `mcp:read` can check models, balance, usage and quotes. For generation or uploads, authorize `mcp:write` only when needed. If `get_account.scopes` lacks `mcp:write`, use the reauthorization instructions in the [MCP setup guide](https://i2v.ai/mcp). Keep the existing task ID or operation key when recovering an earlier request.

| Situation | Agent action |
| --- | --- |
| Quote exceeds budget or cannot be verified | Report the reason. If there is an eligible cheaper model or mode, present a fresh quote within the same budget. |
| Key expired, IP denied, or OAuth is read-only | Explain the failing credential or permission and resume after it is fixed. Do not change account settings automatically. |
| Submission times out or returns SUBMISSION_PENDING | Use `recover` first. A missing receipt can be temporary. If replaying, use the original key, model, inputs, cap, revision and connection recovery setting. The server still enforces the cap for any new submission. |
| Task fails | Return the task ID and reported error. Do not silently submit a replacement. |
| Download interrupted or output exists | Keep the task ID and use a fresh path or directory for the next download attempt. |

See [setup and troubleshooting](https://i2v.ai/cli), [MCP guide](https://i2v.ai/docs/mcp), and [errors and retries](https://i2v.ai/docs/errors).
