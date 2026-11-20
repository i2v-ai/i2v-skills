---
name: i2v-integrate
description: Integrate the i2v.ai image and video API into an existing backend, SaaS product, or workflow. Use when the user asks to add i2v.ai API code, build a job or webhook handler, migrate an integration, or connect n8n, Make, or another automation platform.
metadata:
  author: i2v.ai
  version: "1.0.0"
---

# Integrate the i2v.ai Media API

Find the application's normal backend or workflow entry point and reuse its secret, job, authorization, and storage conventions. Inspect the [published OpenAPI](https://api.i2v.ai/openapi.json), [media workflow](https://i2v.ai/docs/media-workflow), and [runnable examples](https://github.com/i2v-ai/i2v-api-examples) before implementing against a model or operation. If an MCP connection is available, use its read-only model catalog and parameter tools to check the model. For the application's runtime, use server-side REST or the supported SDK.

1. Keep the API key in the server's secret store or an automation credential. Authorize the application user or tenant before quoting, creating, querying, or cancelling tasks. The account that owns the selected key pays for the work.
2. Quote the exact model and inputs. Preserve the approved USD ceiling as a decimal string, and submit it with the quoted revision and a stable `Idempotency-Key`. Store the key, unchanged submission, and task ID on an application job owned by the requesting tenant. If the response is lost, look up the submission under the original key and credential. Never assign a new key just to recover a prior submission.
3. Poll the original task with bounded backoff, or verify signed webhooks and keep polling as a fallback. Keep local wait cancellation distinct from remote job cancellation. Handle the provider-claimed state and terminal successes and failures. Keep asset URLs and original request bodies out of routine logs.
4. Verify through the actual application or workflow entry point. Cover safe quote mode, retransmission of the same logical operation, and at least one failure that changes what a caller should do. Use local fixtures by default. Run a paid generation only when the task, account, and budget have been authorized.

Read [Recovery and delivery](references/recovery.md) when implementing a workflow, an upload, or a webhook.
