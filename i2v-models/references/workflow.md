# i2v.ai CLI and MCP workflow

## Setup

- Connect the remote Streamable HTTP MCP server at `https://i2v.ai/api/mcp` through a client that supports its authentication. Read-only OAuth can discover models and return quotes. Task creation and upload need write authorization.
- For the bundled CLI, set `I2V_API_KEY` in the shell that starts the agent. In bash or zsh use `export I2V_API_KEY="YOUR_API_KEY"`. In PowerShell use `$env:I2V_API_KEY = "YOUR_API_KEY"`. Keep this value outside committed settings and logs.
- With a desktop client that launches stdio, run `node /absolute/path/to/i2v-cli.mjs mcp`. Provide the key through the client's environment. For local file operations set `I2V_WORKSPACE_DIR` to the specific project directory. Use placeholders in example client configs.
- Public CLI commands `list`, `doc` and `price` work without a key. `price` shows catalog rates and units. `quote` uses the actual account and inputs. `balance` returns available and reserved USD.

## Each operation

Use `node SCRIPT doc MODEL --schema` for machine-readable constraints. Use `node SCRIPT doc MODEL --locale zh` for Chinese Markdown. Supply exactly one of `--input`, `--input-file` and `--stdin` to quote or run. With input JSON files, store model parameters such as the prompt and reference URL directly in the object.

`run --no-wait` returns the task receipt as soon as available. Use `status TASK_ID --wait 120` to resume without a new charge. The default `run` wait is 300 seconds. A local wait ending does not cancel the remote task.

| Situation | Agent action |
| --- | --- |
| Quote exceeds budget or cannot be verified | Report the reason. If there is an eligible cheaper model or mode, present a fresh quote within the same budget. |
| Key expired, IP denied, or OAuth is read-only | Explain the failing credential or permission and resume after it is fixed. Do not change account settings automatically. |
| Submission times out or returns SUBMISSION_PENDING | Use the original key, model, inputs and cap. CLI retries can use `--replay` to recover an existing receipt without rechecking a changed catalog before the server sees the key. The server still enforces the cap for any new submission. |
| Task fails | Return the task ID and reported error. Do not silently submit a replacement. |
| Download interrupted or output exists | Keep the task ID and use a fresh path or directory for the next download attempt. |

See [setup and troubleshooting](https://i2v.ai/cli), [MCP guide](https://i2v.ai/docs/mcp), and [errors and retries](https://i2v.ai/docs/errors).
