#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const VERSION = '1.2.0';
const DEFAULT_ORIGIN = 'https://i2v.ai';
const SUBMISSION_TIMEOUT = 18_000;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

class CliError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function invalid(message) {
  return new CliError('invalid_argument', message);
}

function usdAtoms(value) {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,8})?$/.test(value)
  ) {
    throw invalid(
      'Supply a USD decimal string with up to eight decimal places.'
    );
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(8, '0'));
}

function budget(value = process.env.I2V_MAX_COST_USD) {
  if (value === undefined) {
    throw invalid(
      'A spending ceiling is required. Supply --max-cost-usd or I2V_MAX_COST_USD.'
    );
  }
  usdAtoms(value);
  return value;
}

function operationKey(value) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw invalid(
      'Use an idempotency key of 8–128 letters, digits, periods, underscores, colons or hyphens.'
    );
  }
  return value;
}

function modelId(value) {
  if (typeof value !== 'string' || !MODEL_ID.test(value)) {
    throw invalid('Supply a public model ID from list.');
  }
  return value;
}

function inputObject(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw invalid('Model inputs must be a JSON object.');
  }
  return value;
}

function localHttp(url) {
  return (
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  );
}

function origin() {
  const url = new URL(process.env.I2V_BASE_URL || DEFAULT_ORIGIN);
  if (
    (!localHttp(url) && url.protocol !== 'https:') ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw invalid(
      'I2V_BASE_URL must be an HTTPS origin or a local test origin.'
    );
  }
  return url.origin;
}

const fixedApiPaths = new Set([
  '/api/mcp',
  '/api/v1/generation-models',
  '/api/docs/markdown',
  '/cli/release.json',
]);

async function api(
  path,
  { body, authenticated = false, protocol, timeout = SUBMISSION_TIMEOUT } = {}
) {
  const url = new URL(path, origin());
  if (!fixedApiPaths.has(url.pathname) || url.origin !== origin()) {
    throw invalid('Unsupported API path.');
  }
  const headers = {
    Accept: body === undefined ? '*/*' : 'application/json, text/event-stream',
  };
  if (authenticated) {
    const key = process.env.I2V_API_KEY?.trim();
    if (!key)
      throw new CliError(
        'unauthorized',
        'Set I2V_API_KEY in the environment that starts i2v.'
      );
    headers.Authorization = 'Bearer ' + key;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (protocol) headers['MCP-Protocol-Version'] = protocol;
  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      ...(body === undefined
        ? {}
        : { method: 'POST', body: JSON.stringify(body) }),
    });
    if (response.ok) {
      if (response.status === 202 || response.status === 204) return undefined;
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        return await readRpcEvent(response, body.id);
      }
      return path.startsWith('/api/docs/markdown?')
        ? await response.text()
        : await response.json();
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      'connection_failed',
      'The i2v.ai request did not return a usable response.'
    );
  }
  const code = {
    401: 'unauthorized',
    403: 'access_denied',
    404: 'not_found',
    429: 'rate_limited',
  }[response.status];
  throw new CliError(
    code || 'http_error',
    'i2v.ai returned HTTP ' + response.status + '.',
    {
      status: response.status,
      retryAfter: response.headers.get('retry-after') || undefined,
    }
  );
}

async function readRpcEvent(response, id) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let lines = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      for (
        let newline = buffer.indexOf('\n');
        newline !== -1;
        newline = buffer.indexOf('\n')
      ) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:'))
          lines.push(line.slice(5).replace(/^ /, ''));
        if (line === '' && lines.length) {
          const event = JSON.parse(lines.join('\n'));
          if (event.id === id) return event;
          lines = [];
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new CliError(
    'connection_failed',
    'The MCP stream closed before the response.'
  );
}

function rpc(message, protocol, timeout) {
  return api('/api/mcp', {
    body: message,
    authenticated: true,
    protocol,
    timeout,
  });
}

async function tool(name, args, protocol, timeout) {
  const id = randomUUID();
  const reply = await rpc(
    {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    protocol,
    timeout
  );
  if (reply?.id !== id || !reply.result) {
    throw new CliError(
      'protocol_error',
      'i2v.ai returned an invalid MCP tool response.'
    );
  }
  const result = reply.result;
  const value =
    result.structuredContent ??
    JSON.parse(result.content.find((item) => item.type === 'text').text);
  if (result.isError) {
    const { code, message, ...details } = value.error;
    throw new CliError(code, message, details);
  }
  return value;
}

async function catalog({ type, task, provider, q } = {}) {
  const { data } = await api('/api/v1/generation-models');
  const match = (value, query) =>
    String(value ?? '')
      .toLowerCase()
      .includes(query.toLowerCase());
  return data.filter(
    (model) =>
      (!type || model.mediaType === type) &&
      (!task ||
        match(model.category, task) ||
        (task === 'image-generation' &&
          model.taskTypes?.includes('text-to-image')) ||
        (task === 'video-generation' &&
          model.taskTypes?.some(
            (mode) =>
              !['text-to-image', 'image-to-image', 'video-to-video'].includes(
                mode
              )
          )) ||
        (model.taskTypes ?? []).some((mode) => match(mode, task)) ||
        (task === 'image-editing' &&
          model.taskTypes?.includes('image-to-image')) ||
        (task === 'video-editing' &&
          model.taskTypes?.includes('video-to-video'))) &&
      (!provider || match(model.provider, provider)) &&
      (!q ||
        match(
          [model.id, model.slug, model.name, ...(model.tags ?? [])].join(' '),
          q
        ))
  );
}

function publishedPrices(models) {
  return models.map(
    ({ id, name, catalogPriceUsd, priceUnit, priceLabel, prices }) => ({
      id,
      name,
      currency: 'USD',
      catalogPriceUsd,
      priceUnit,
      priceLabel,
      prices,
    })
  );
}

async function fileInWorkspace(path, workspace, output = false) {
  if (typeof path !== 'string' || !path.trim())
    throw invalid('Supply a local path.');
  const root = await realpath(workspace);
  const candidate = resolve(root, path);
  const pathWithin = (value) => {
    const rel = relative(root, value);
    return (
      rel !== '..' &&
      !rel.startsWith('../') &&
      !rel.startsWith('..\\') &&
      !isAbsolute(rel)
    );
  };
  if (!pathWithin(candidate))
    throw invalid('The local path must be inside the configured workspace.');
  const actual = await realpath(output ? dirname(candidate) : candidate);
  if (!pathWithin(actual))
    throw invalid(
      'The resolved local path is outside the configured workspace.'
    );
  return output ? join(actual, basename(candidate)) : actual;
}

async function unusedPath(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new CliError('output_exists', 'The output file already exists.');
}

function assetUrl(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(localHttp(url) && url.origin === origin()))
  ) {
    throw new CliError(
      'invalid_asset_url',
      'The media endpoint must use HTTPS.'
    );
  }
  return url;
}

function remaining(deadline) {
  const time = deadline - Date.now();
  if (time <= 0)
    throw new CliError(
      'connection_failed',
      'The local operation reached its time limit.'
    );
  return Math.min(time, SUBMISSION_TIMEOUT);
}

async function upload(
  path,
  workspace,
  explicitType,
  protocol,
  timeout = 180_000
) {
  const deadline = Date.now() + timeout;
  const source = await fileInWorkspace(path, workspace);
  const metadata = await stat(source);
  const contentType = explicitType ?? TYPES[extname(source).toLowerCase()];
  if (!metadata.isFile() || !metadata.size || !contentType) {
    throw invalid(
      'Supply a nonempty media file with a supported extension or --content-type.'
    );
  }
  const ticket = await tool(
    'create_upload_url',
    {
      fileName: basename(source),
      fileSize: metadata.size,
      contentType,
    },
    protocol,
    remaining(deadline)
  );
  const stream = createReadStream(source);
  try {
    const response = await fetch(assetUrl(ticket.uploadUrl), {
      method: 'PUT',
      redirect: 'error',
      body: stream,
      duplex: 'half',
      headers: {
        'Content-Type': ticket.contentType,
        'Content-Length': String(metadata.size),
      },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (!response.ok) throw new Error();
  } catch {
    throw new CliError(
      'upload_failed',
      'The upload did not complete. Check the file and try again.'
    );
  } finally {
    stream.destroy();
  }
  return tool(
    'complete_upload',
    { assetId: ticket.assetId },
    protocol,
    remaining(deadline)
  );
}

function outputFilename(item, index) {
  const extension = extname(assetUrl(item.url).pathname).toLowerCase();
  const contentType = String(item.mimeType || item.contentType || '').split(
    ';'
  )[0];
  const guessed = Object.entries(TYPES).find(
    ([, type]) => type === contentType
  )?.[0];
  return (
    'output-' + (index + 1) + (TYPES[extension] ? extension : guessed || '.bin')
  );
}

async function downloadFile(url, output, timeout) {
  const temp = join(dirname(output), '.i2v-' + randomUUID() + '.part');
  const signal = AbortSignal.timeout(timeout);
  let created = false;
  try {
    const response = await fetch(assetUrl(url), { redirect: 'error', signal });
    if (!response.ok || !response.body) throw new Error();
    const file = createWriteStream(temp, { flags: 'wx', mode: 0o600 });
    file.once('open', () => {
      created = true;
    });
    await pipeline(Readable.fromWeb(response.body), file, { signal });
    await link(temp, output);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new CliError('output_exists', 'The output file already exists.');
    throw new CliError(
      'download_failed',
      'Could not save the result. Check the path or try status again.'
    );
  } finally {
    if (created) await rm(temp, { force: true });
  }
}

function outputOptions(out, outDir) {
  if (out && outDir) throw invalid('Choose --out or --out-dir.');
  return out || outDir;
}

async function checkOutput(workspace, out, outDir) {
  if (out) await unusedPath(await fileInWorkspace(out, workspace, true));
  if (
    outDir &&
    !(await stat(await fileInWorkspace(outDir, workspace))).isDirectory()
  ) {
    throw invalid('The output directory must exist.');
  }
}

async function saveOutputs(task, workspace, out, outDir, timeout = 180_000) {
  if (!outputOptions(out, outDir) || task.status !== 'success') return task;
  const outputs = (task.output ?? []).filter((item) => item?.url);
  if (!outputs.length)
    throw new CliError(
      'missing_output',
      'The task returned no downloadable files.',
      { taskId: task.taskId }
    );
  if (out && outputs.length !== 1) {
    throw new CliError(
      'multiple_outputs',
      'This task has multiple files. Use --out-dir.',
      { taskId: task.taskId }
    );
  }
  const outputDir = outDir ? await fileInWorkspace(outDir, workspace) : null;
  const paths = await Promise.all(
    outputs.map((item, index) =>
      fileInWorkspace(
        out || join(outputDir, outputFilename(item, index)),
        workspace,
        true
      )
    )
  );
  const saved = [];
  const deadline = Date.now() + timeout;
  try {
    for (const [index, path] of paths.entries()) {
      await unusedPath(path);
      await downloadFile(
        outputs[index].url,
        path,
        Math.max(1, deadline - Date.now())
      );
      saved.push(path);
    }
  } catch (error) {
    throw new CliError(
      error.code || 'download_failed',
      'Could not finish saving the result.',
      {
        taskId: task.taskId,
        saved,
        next: 'Use status with a fresh output directory to download again.',
      }
    );
  }
  return { ...task, saved };
}

async function quote(model, inputs, protocol, timeout) {
  return tool(
    'estimate_cost',
    { modelId: modelId(model), inputs: inputObject(inputs) },
    protocol,
    timeout
  );
}

const stateHome = () =>
  process.env.I2V_STATE_DIR ??
  join(
    process.env.LOCALAPPDATA ||
      process.env.XDG_STATE_HOME ||
      join(homedir(), '.local', 'state'),
    'i2v-ai'
  );

async function beginReceipt(modelId, idempotencyKey) {
  const dir = join(stateHome(), 'receipts');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const hash = createHash('sha256')
    .update(
      JSON.stringify([origin(), process.env.I2V_API_KEY?.trim(), idempotencyKey])
    )
    .digest('hex');
  const path = join(dir, hash + '.json');
  const data = {
    modelId,
    idempotencyKey,
    origin: origin(),
    createdAt: new Date().toISOString(),
    status: 'submitting',
  };
  try {
    await writeFile(path, JSON.stringify(data) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return { path, data };
}

async function finishReceipt(receipt, taskId) {
  const original = JSON.parse(await readFile(receipt.path, 'utf8'));
  if (original.modelId !== receipt.data.modelId) return;
  const temporary = receipt.path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(
      temporary,
      JSON.stringify({ ...original, taskId, status: 'accepted' }) + '\n',
      { flag: 'wx', mode: 0o600 }
    );
    await rename(temporary, receipt.path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function prepare(model, inputs, maxCostUsd) {
  if (maxCostUsd !== undefined) usdAtoms(maxCostUsd);
  return tool('prepare_generation', {
    modelId: modelId(model),
    inputs: inputObject(inputs),
    maxCostUsd,
  });
}

const releaseVersion = /^\d{1,8}\.\d{1,8}\.\d{1,8}$/;

function versionReport(current, published) {
  const available = typeof published === 'string' && releaseVersion.test(published);
  if (typeof current !== 'string' || !releaseVersion.test(current))
    return { current: null, published: available ? published : null, status: 'not_detected' };
  if (!available)
    return { current, published: null, status: 'unavailable' };
  const expected = published.split('.').map(Number);
  const diff =
    current.split('.').map((part, index) => Number(part) - expected[index]).find(Boolean) ?? 0;
  return {
    current,
    published,
    status: diff < 0 ? 'update_available' : diff > 0 ? 'ahead' : 'current',
  };
}

async function localSkillVersion() {
  try {
    const markdown = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
    const header = markdown.split('---', 3)[1] ?? '';
    return /^name: i2v-models\s*$/m.test(header)
      ? /^  version: ["']?(\d+\.\d+\.\d+)["']?\s*$/m.exec(header)?.[1]
      : undefined;
  } catch {
    return undefined;
  }
}

async function readRelease(timeout = 6000) {
  return api('/cli/release.json', { timeout }).catch(() => null);
}

function addUpdateInstructions(result, release, skillVersion) {
  const updates = [
    ['CLI', versionReport(VERSION, release?.cliVersion)],
    ['Agent Skill', versionReport(skillVersion, release?.skillVersion)],
    ['MCP server', versionReport(result.serverInfo?.version, release?.mcpServerVersion)],
  ].filter(([, report]) => report.status === 'update_available');
  if (!updates.length) return;
  const versions = updates.map(([name, report]) => `${name} ${report.current} → ${report.published}`);
  const message = `i2v.ai updates available (${versions.join(', ')}). Run the i2v.ai CLI doctor command for details.`;
  result.instructions = [result.instructions, message].filter(Boolean).join('\n');
}

async function doctor() {
  const [models, release, skillVersion, connection] = await Promise.all([
    catalog().catch(() => null),
    readRelease(),
    localSkillVersion(),
    process.env.I2V_API_KEY?.trim()
      ? (async () => {
          try {
            const id = randomUUID();
            const handshake = await rpc({
              jsonrpc: '2.0',
              id,
              method: 'initialize',
              params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'i2v-cli-doctor', version: VERSION },
              },
            });
            if (handshake?.id !== id || !handshake.result?.protocolVersion)
              throw new CliError(
                'protocol_error',
                'MCP initialization failed.'
              );
            const manifestId = randomUUID();
            const manifest = await rpc(
              { jsonrpc: '2.0', id: manifestId, method: 'tools/list' },
              handshake.result.protocolVersion
            );
            if (
              manifest?.id !== manifestId ||
              !Array.isArray(manifest.result?.tools)
            )
              throw new CliError(
                'protocol_error',
                'MCP tool discovery failed.'
              );
            const toolNames = manifest.result.tools.map(({ name }) => name);
            return {
              status: 'ready',
              protocolVersion: handshake.result.protocolVersion,
              serverVersion: handshake.result.serverInfo?.version,
              toolNames,
              missingWorkflowTools: [
                'recommend_models',
                'prepare_generation',
                'recover_submission',
                'get_usage',
              ].filter((name) => !toolNames.includes(name)),
            };
          } catch (error) {
            return {
              status: 'unavailable',
              code: error.code ?? 'connection_failed',
            };
          }
        })()
      : { status: 'not_configured' },
  ]);
  return {
    cliVersion: VERSION,
    endpoint: origin(),
    catalogModels: models?.length ?? null,
    connection,
    updates: {
      cli: versionReport(VERSION, release?.cliVersion),
      skill: versionReport(skillVersion, release?.skillVersion),
      remoteMcp: versionReport(connection.serverVersion, release?.mcpServerVersion),
      setupUrl: new URL('/mcp', origin()).href,
    },
  };
}

async function submit(
  { modelId: model, inputs, maxCostUsd, idempotencyKey, replay, ...optional },
  protocol,
  receipt,
  timeout = 38_000
) {
  const deadline = Date.now() + timeout;
  const max = budget(maxCostUsd);
  const key = operationKey(idempotencyKey);
  modelId(model);
  inputObject(inputs);
  if (!replay) {
    const estimate = await quote(model, inputs, protocol, remaining(deadline));
    const amount = estimate.cost?.currency === 'USD' && estimate.cost.amount;
    if (typeof amount !== 'string')
      throw new CliError(
        'quote_unavailable',
        'A USD quote could not be verified.'
      );
    if (usdAtoms(amount) > usdAtoms(max)) {
      throw new CliError(
        'budget_exceeded',
        'The current quote exceeds the spending ceiling.',
        { quote: estimate.cost }
      );
    }
  }
  const savedReceipt = await beginReceipt(model, key).catch(() => {
    throw new CliError(
      'receipt_unavailable',
      'Could not save the local submission receipt. No task was submitted.'
    );
  });
  receipt?.(key);
  try {
    const result = await tool(
      'create_task',
      {
        modelId: model,
        inputs,
        maxCostUsd: max,
        idempotencyKey: key,
        ...optional,
      },
      protocol,
      remaining(deadline)
    );
    if (typeof result?.taskId !== 'string' || !result.taskId)
      throw new CliError('protocol_error', 'Missing task ID.');
    let receiptUpdated = true;
    await finishReceipt(savedReceipt, result.taskId).catch(() => {
      receiptUpdated = false;
    });
    return {
      ...result,
      idempotencyKey: key,
      receiptPath: savedReceipt.path,
      receiptUpdated,
    };
  } catch (error) {
    const next =
      'Use recover with the same key to look for the original task. Replay only with the exact original inputs, budget, and options.';
    throw new CliError(
      error.code || 'submission_unknown',
      error.message || next,
      {
        ...error.details,
        idempotencyKey: key,
        receiptPath: savedReceipt.path,
        next,
      }
    );
  }
}

async function readTask(id, waitSeconds, protocol) {
  if (typeof id !== 'string' || !id.trim()) throw invalid('Supply a task ID.');
  const deadline = Date.now() + waitSeconds * 1000;
  let backoff = 2_000;
  let last;
  for (;;) {
    try {
      last = await tool(
        'get_task',
        { taskId: id },
        protocol,
        waitSeconds
          ? Math.max(1, Math.min(SUBMISSION_TIMEOUT, deadline - Date.now()))
          : SUBMISSION_TIMEOUT
      );
      if (['success', 'fail'].includes(last.status))
        return { ...last, taskId: id };
    } catch (error) {
      if (
        !waitSeconds ||
        !['rate_limited', 'connection_failed', '503'].includes(error.code)
      ) {
        throw new CliError(
          error.code || 'status_unavailable',
          error instanceof CliError
            ? error.message
            : 'The task status could not be read.',
          { ...error.details, taskId: id }
        );
      }
      const retryAfter = Number(error.details?.retryAfter) * 1000;
      if (retryAfter > 0) backoff = Math.max(backoff, retryAfter);
    }
    if (Date.now() + backoff >= deadline)
      return {
        ...last,
        taskId: id,
        status: last?.status ?? 'unknown',
        next: 'status',
      };
    await delay(backoff);
    backoff = Math.min(Math.round(backoff * 1.5), 15_000);
  }
}

const localTools = [
  {
    name: 'list_prices',
    description:
      'List public catalog USD prices, optionally filtering by keyword.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'upload_file',
    description:
      'Upload an explicitly requested media file inside I2V_WORKSPACE_DIR and return an owned URL.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' }, contentType: { type: 'string' } },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'download_task',
    description:
      'Save a completed task in I2V_WORKSPACE_DIR without overwriting files. Pass outPath for one file or outDir for several.',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
        outPath: { type: 'string' },
        outDir: { type: 'string' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
];

function toolResponse(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function toolFailure(error) {
  return {
    ...toolResponse({
      error: {
        code: error.code || 'local_error',
        message:
          error instanceof CliError ? error.message : 'Local operation failed.',
        ...error.details,
      },
    }),
    isError: true,
  };
}

async function callLocal(name, args, protocol) {
  if (name === 'create_task') {
    if (args.maxCredits !== undefined)
      throw invalid('Use a USD spending ceiling in maxCostUsd.');
    const {
      modelId,
      inputs,
      maxCostUsd,
      idempotencyKey,
      replay,
      callBackUrl,
      autoFix,
      expectedRevision,
      recoveryScope,
    } = args;
    if (replay !== undefined && typeof replay !== 'boolean')
      throw invalid('replay must be a boolean.');
    return submit(
      {
        modelId,
        inputs,
        maxCostUsd,
        idempotencyKey,
        replay,
        callBackUrl,
        autoFix,
        expectedRevision,
        recoveryScope,
      },
      protocol,
      undefined,
      20_000
    );
  }
  if (name === 'list_prices')
    return publishedPrices(await catalog({ q: args.q }));
  const workspace = process.env.I2V_WORKSPACE_DIR;
  if (!workspace)
    throw invalid('Set I2V_WORKSPACE_DIR to enable MCP file access.');
  if (name === 'upload_file')
    return upload(args.path, workspace, args.contentType, protocol, 25_000);
  if (!outputOptions(args.outPath, args.outDir))
    throw invalid('Supply outPath or outDir.');
  const task = await readTask(args.taskId, 0, protocol);
  return saveOutputs(task, workspace, args.outPath, args.outDir, 25_000);
}

async function stdio() {
  let protocol;
  const handled = new Set([
    'create_task',
    ...localTools.map((item) => item.name),
  ]);
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  const write = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  async function handle(message) {
    const { method, id } = message;
    if (id === undefined) return;
    try {
      let reply;
      if (method === 'ping') reply = { jsonrpc: '2.0', id, result: {} };
      else if (method === 'tools/call' && handled.has(message.params?.name)) {
        let result;
        try {
          result = toolResponse(
            await callLocal(
              message.params.name,
              message.params.arguments ?? {},
              protocol
            )
          );
        } catch (error) {
          result = toolFailure(error);
        }
        reply = { jsonrpc: '2.0', id, result };
      } else if (method === 'initialize') {
        const [initialized, release, skillVersion] = await Promise.all([
          rpc(message, protocol),
          readRelease(2000),
          localSkillVersion(),
        ]);
        reply = initialized;
        if (reply?.result) {
          protocol = reply.result.protocolVersion;
          addUpdateInstructions(reply.result, release, skillVersion);
        }
      } else {
        reply = await rpc(message, protocol);
        if (method === 'tools/list' && reply?.result?.tools) {
          const create = reply.result.tools.find(
            (item) => item.name === 'create_task'
          );
          if (create?.inputSchema) {
            const schema = create.inputSchema;
            schema.properties.maxCredits = undefined;
            schema.properties.replay = {
              type: 'boolean',
              description:
                'Replay an uncertain submission with its original key, inputs and budget.',
            };
            schema.required = [
              ...new Set([
                ...(schema.required ?? []),
                'maxCostUsd',
                'idempotencyKey',
              ]),
            ];
          }
          reply.result.tools.push(
            ...localTools.filter(
              (item) =>
                item.name === 'list_prices' || process.env.I2V_WORKSPACE_DIR
            )
          );
        }
      }
      if (reply?.id !== id)
        throw new CliError('protocol_error', 'Missing MCP response.');
      write(reply);
    } catch (error) {
      write({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: toolFailure(error).content[0].text },
      });
    }
  }
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Invalid JSON' },
      });
      return;
    }
    if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      write({
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: { code: -32600, message: 'Invalid request' },
      });
      return;
    }
    void handle(message);
  });
}

const HELP = `i2v.ai CLI ${VERSION} · Node.js 20+

  list [--type image|video] [--task CATEGORY] [--provider BRAND] [--q QUERY]
  doc MODEL [--schema] [--locale en|zh]
  price [QUERY]
  recommend [QUERY] [--task TYPE] [--model MODEL] [--input CONSTRAINTS_JSON]
  plan MODEL (--input JSON | --input-file FILE | --stdin) [--max-cost-usd USD]
  recover IDEMPOTENCY_KEY
  doctor
  balance
  usage [--range today|yesterday|7d|30d|90d]
  quote MODEL (--input JSON | --input-file FILE | --stdin)
  upload FILE [--content-type MIME]
  run MODEL (--input JSON | --input-file FILE | --stdin) --max-cost-usd USD
            [--expected-revision N] [--idempotency-key KEY] [--replay] [--no-wait | --wait SECONDS]
            [--out FILE | --out-dir EXISTING_DIR]
  status TASK_ID [--wait SECONDS] [--out FILE | --out-dir EXISTING_DIR]
  mcp

Pass --json for structured results. Set I2V_API_KEY for account and task actions.
I2V_MAX_COST_USD supplies a default spending ceiling.
I2V_STATE_DIR overrides where local submission receipts are saved.
I2V_WORKSPACE_DIR enables local MCP file tools and sets the CLI file root.
I2V_BASE_URL overrides the API origin. It must be trusted before forwarding a key.
`;

const flags = {
  json: 'boolean',
  type: 'string',
  task: 'string',
  range: 'string',
  model: 'string',
  'expected-revision': 'string',
  provider: 'string',
  q: 'string',
  schema: 'boolean',
  locale: 'string',
  input: 'string',
  'input-file': 'string',
  stdin: 'boolean',
  'content-type': 'string',
  'max-cost-usd': 'string',
  'idempotency-key': 'string',
  replay: 'boolean',
  'no-wait': 'boolean',
  wait: 'string',
  out: 'string',
  'out-dir': 'string',
};
const inputFlags = ['input', 'input-file', 'stdin'];
const outputFlags = ['wait', 'out', 'out-dir'];
const commands = {
  list: [0, 0, ['type', 'task', 'provider', 'q']],
  doc: [1, 1, ['schema', 'locale']],
  price: [0, 1, []],
  recommend: [0, 1, ['task', 'model', ...inputFlags]],
  plan: [1, 1, [...inputFlags, 'max-cost-usd']],
  recover: [1, 1, []],
  doctor: [0, 0, []],
  balance: [0, 0, []],
  usage: [0, 0, ['range']],
  quote: [1, 1, inputFlags],
  upload: [1, 1, ['content-type']],
  run: [
    1,
    1,
    [
      ...inputFlags,
      ...outputFlags,
      'max-cost-usd',
      'expected-revision',
      'idempotency-key',
      'replay',
      'no-wait',
    ],
  ],
  status: [1, 1, outputFlags],
  mcp: [0, 0, []],
};

function emitted(value, json) {
  if (!json && typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, json ? 0 : 2));
}

async function readInput(values, workspace) {
  const sources = inputFlags.filter((name) => values[name] !== undefined);
  if (sources.length !== 1)
    throw invalid('Supply exactly one of --input, --input-file or --stdin.');
  if (values.input !== undefined) {
    try {
      return inputObject(JSON.parse(values.input));
    } catch {
      throw invalid('Invalid input JSON object.');
    }
  }
  const input = values.stdin
    ? process.stdin
    : createReadStream(await fileInWorkspace(values['input-file'], workspace));
  const buffers = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > 1024 * 1024) throw invalid('Input JSON is limited to 1 MB.');
    buffers.push(chunk);
  }
  try {
    return inputObject(JSON.parse(Buffer.concat(buffers).toString('utf8')));
  } catch {
    throw invalid('Invalid input JSON object.');
  }
}

function waitTime(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) > 3600)
    throw invalid('--wait accepts 0–3600 seconds.');
  return Number(value);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help')
    return console.log(HELP);
  if (command === '--version') return console.log(VERSION);
  if (!Object.hasOwn(commands, command))
    throw invalid('Unknown command. See --help.');
  const [min, max, optionNames] = commands[command];
  const options = Object.fromEntries(
    ['json', ...optionNames].map((name) => [name, { type: flags[name] }])
  );
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true });
  } catch (error) {
    throw invalid(error.message);
  }
  const { values, positionals } = parsed;
  if (positionals.length < min || positionals.length > max)
    throw invalid('Check the arguments in --help.');
  const [arg] = positionals;
  const workspace = process.env.I2V_WORKSPACE_DIR || process.cwd();
  let result;
  switch (command) {
    case 'mcp':
      return stdio();
    case 'list': {
      if (values.type && !['image', 'video'].includes(values.type))
        throw invalid('--type accepts image or video.');
      const models = await catalog(values);
      result = values.json
        ? models
        : models
            .map((model) => [model.id, model.mediaType, model.name].join('\t'))
            .join('\n');
      break;
    }
    case 'doc':
      if (values.schema) {
        result = (await catalog()).find(
          (model) => model.id === modelId(arg) || model.slug === arg
        );
        if (!result)
          throw new CliError(
            'not_found',
            'Model was not found in the public catalog.'
          );
      } else {
        const query = new URLSearchParams({
          path: 'models/' + modelId(arg),
          locale: values.locale || 'en',
        });
        result = await api('/api/docs/markdown?' + query);
      }
      break;
    case 'recommend': {
      const constraints = inputFlags.some((flag) => values[flag] !== undefined)
        ? await readInput(values, workspace)
        : {};
      result = await tool('recommend_models', {
        ...constraints,
        ...(arg ? { query: arg } : {}),
        ...(values.task ? { task: values.task } : {}),
        ...(values.model ? { modelId: values.model } : {}),
      });
      break;
    }
    case 'plan':
      result = await prepare(
        arg,
        await readInput(values, workspace),
        values['max-cost-usd']
      );
      break;
    case 'recover':
      result = await tool('recover_submission', {
        idempotencyKey: operationKey(arg),
      });
      break;
    case 'doctor':
      result = await doctor();
      break;
    case 'price':
      result = publishedPrices(await catalog({ q: arg }));
      break;
    case 'balance': {
      const { balance, reserved, funding } = await tool('get_account', {});
      result = { balance, reserved, funding };
      break;
    }
    case 'usage':
      result = await tool('get_usage', { range: values.range });
      break;
    case 'quote':
      result = await quote(arg, await readInput(values, workspace));
      break;
    case 'upload':
      result = await upload(arg, workspace, values['content-type']);
      break;
    case 'run': {
      const seconds = waitTime(values.wait, values['no-wait'] ? 0 : 300);
      if (values['no-wait'] && values.wait !== undefined)
        throw invalid('Choose --no-wait or --wait.');
      if (!seconds && outputOptions(values.out, values['out-dir']))
        throw invalid('Use status to download after --no-wait.');
      outputOptions(values.out, values['out-dir']);
      await checkOutput(workspace, values.out, values['out-dir']);
      if (values.replay && !values['idempotency-key'])
        throw invalid('--replay requires the original --idempotency-key.');
      const revision = values['expected-revision'];
      if (
        revision !== undefined &&
        (!/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision)))
      )
        throw invalid('--expected-revision must be a nonnegative integer.');
      result = await submit(
        {
          modelId: arg,
          inputs: await readInput(values, workspace),
          maxCostUsd: values['max-cost-usd'],
          idempotencyKey: values['idempotency-key'] ?? randomUUID(),
          replay: values.replay,
          ...(revision !== undefined
            ? { expectedRevision: Number(revision) }
            : {}),
        },
        undefined,
        (key) => console.error('[i2v] Idempotency-Key: ' + key)
      );
      console.error('[i2v] Task: ' + result.taskId);
      if (seconds) {
        const task = await readTask(result.taskId, seconds);
        result = await saveOutputs(
          { ...result, ...task },
          workspace,
          values.out,
          values['out-dir']
        );
      }
      break;
    }
    case 'status':
      outputOptions(values.out, values['out-dir']);
      result = await saveOutputs(
        await readTask(arg, waitTime(values.wait, 0)),
        workspace,
        values.out,
        values['out-dir']
      );
      break;
  }
  emitted(result, values.json);
  if (result?.status === 'fail' || result?.connection?.status === 'unavailable')
    process.exitCode = 1;
  if (result?.status === 'over_budget') process.exitCode = 3;
}

main().catch((error) => {
  const { code = 'local_error', details = {} } = error;
  const message =
    error instanceof CliError
      ? error.message
      : 'Local file or response could not be processed.';
  if (process.argv.includes('--json') && process.argv[2] !== 'mcp')
    emitted({ error: { code, message, ...details } }, true);
  else
    console.error(
      '[i2v] ' + message,
      Object.keys(details).length ? JSON.stringify(details) : ''
    );
  process.exitCode =
    code === 'invalid_argument' ? 2 : code === 'budget_exceeded' ? 3 : 1;
});
