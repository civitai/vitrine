#!/usr/bin/env node
// Grafana skill — query datasources and manage dashboards/connections via the
// Grafana HTTP API. Reads GRAFANA_URL + auth from the project-root .env
// (env vars win). Read-only by default; writes need --writable, and writes to a
// non-localhost target additionally need --confirm-prod.
//
// Usage: node .claude/skills/grafana/grafana.mjs <command> [args] [flags]
// See SKILL.md for the full command + flag reference.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- .env loader (minimal KEY=VALUE; real env vars take precedence) ---
function parseDotEnv(path) {
  const out = {};
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    /* no file here — fine */
  }
  return out;
}

// Precedence (low → high): project-root .env, then this skill dir's own .env,
// then real process.env (handled in envOf). Co-locating a `.env` with the skill
// keeps Grafana creds out of the app's project-root .env; it's gitignored.
function loadDotEnv() {
  const skillDir = dirname(fileURLToPath(import.meta.url));
  return {
    ...parseDotEnv(resolve(process.cwd(), '.env')),
    ...parseDotEnv(resolve(skillDir, '.env')),
  };
}

const FILE_ENV = loadDotEnv();
const envOf = (key, dflt) => process.env[key] ?? FILE_ENV[key] ?? dflt;

// --- Pure, testable helpers (exported) ---

export function isLocalhost(urlString) {
  try {
    const h = new URL(urlString).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

/** Whether an HTTP method mutates state. Used by the generic `api` command;
 * named commands pass their read/write intent explicitly (a query is a POST
 * but semantically a read). */
export function isWriteMethod(method) {
  return String(method).toUpperCase() !== 'GET';
}

/**
 * Decide whether a request is allowed.
 * - read (`isWrite` false): always ok — even if it's an HTTP POST (e.g. queries).
 * - write (`isWrite` true): needs `writable`; if target is non-localhost it also
 *   needs `confirmProd`.
 * Returns { ok: true } or { ok: false, error }.
 */
export function guard({ isWrite, url, writable, confirmProd }) {
  if (!isWrite) return { ok: true };
  if (!writable) {
    return { ok: false, error: 'write blocked: pass --writable (ask the user first)' };
  }
  if (!isLocalhost(url) && !confirmProd) {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep raw */
    }
    return {
      ok: false,
      error: `write blocked: non-local target ${host} — ask the user, then re-run with --confirm-prod`,
    };
  }
  return { ok: true };
}

const SECRET_KEY = /(password|secret|token|securejson|apikey|authorization|basicauth)/i;

/** Deep-redact secret-ish keys so request/response echoes never leak creds. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      o[k] = SECRET_KEY.test(k) ? '***redacted***' : redact(v);
    }
    return o;
  }
  return value;
}

// --- CLI plumbing ---

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--writable') flags.writable = true;
    else if (a === '--confirm-prod') flags.confirmProd = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--quiet' || a === '-q') flags.quiet = true;
    else if (a === '-f' || a === '--file') flags.file = argv[++i];
    else if (a === '--uid') flags.uid = argv[++i];
    else if (a === '--from') flags.from = argv[++i];
    else if (a === '--to') flags.to = argv[++i];
    else if (a === '--limit') flags.limit = Number(argv[++i]);
    else positional.push(a);
  }
  return { positional, flags };
}

function authHeader() {
  const token = envOf('GRAFANA_TOKEN');
  if (token) return `Bearer ${token}`;
  const user = envOf('GRAFANA_USER', 'admin');
  const pass = envOf('GRAFANA_PASSWORD', 'admin');
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function die(msg, code = 1) {
  console.error(`grafana: ${msg}`);
  process.exit(code);
}

async function gfetch(method, path, { body, flags, write = false } = {}) {
  const base = envOf('GRAFANA_URL', 'http://localhost:3001').replace(/\/$/, '');
  const url = `${base}${path}`;
  const decision = guard({
    isWrite: write,
    url: base,
    writable: !!flags?.writable,
    confirmProd: !!flags?.confirmProd,
  });
  if (!decision.ok) die(decision.error, 2);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    die(`${method} ${path} -> HTTP ${res.status}\n${text}`, 1);
  }
  return { status: res.status, json, text };
}

function output(data, flags) {
  const safe = redact(data);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(safe)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
  }
}

function readBodyFile(flags) {
  if (!flags.file) die('this command needs -f <file.json>');
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), flags.file), 'utf8'));
  } catch (e) {
    die(`could not read/parse ${flags.file}: ${e.message}`);
  }
}

async function resolveDatasourceUid(type, flags) {
  if (flags.uid) return flags.uid;
  const { json } = await gfetch('GET', '/api/datasources', { flags });
  const match = (json || []).find((d) => d.type === type);
  if (!match) die(`no datasource of type "${type}" found (use --uid to specify)`);
  return match.uid;
}

function buildQueryModel(type, uid, expr, flags) {
  const fromMs = flags.from ?? String(Date.now() - 3600_000);
  const toMs = flags.to ?? String(Date.now());
  const base = { refId: 'A', datasource: { uid, type } };
  let q;
  if (type === 'loki') {
    q = { ...base, expr, queryType: 'range', maxLines: flags.limit ?? 100 };
  } else if (type === 'prometheus') {
    q = { ...base, expr, range: true, instant: false };
  } else if (type === 'tempo') {
    q = { ...base, query: expr, queryType: 'traceql', limit: flags.limit ?? 20 };
  } else {
    q = { ...base, expr };
  }
  return { queries: [q], from: String(fromMs), to: String(toMs) };
}

const HELP = `grafana — query Grafana + manage dashboards/connections (read-only by default)

Commands:
  query <loki|prometheus|tempo> <expr> [--uid <ds>] [--from <ms>] [--to <ms>] [--limit <n>]
  datasources                          list datasources (connections)
  datasource get <uid>                 get one datasource
  datasource create -f <def.json>      create a connection            [write]
  dashboards [search]                  search dashboards
  dashboard get <uid>                  get a dashboard model
  dashboard upsert -f <model.json>     create/update a dashboard       [write]
  api <GET|POST|PUT|DELETE> <path> [-f body.json]   raw API call

Flags: --writable (allow writes), --confirm-prod (allow write to non-localhost),
       --json, -q/--quiet, -f/--file, --uid, --from, --to, --limit

Env (.env): GRAFANA_URL (default http://localhost:3001),
            GRAFANA_TOKEN  OR  GRAFANA_USER/GRAFANA_PASSWORD (default admin/admin)`;

async function main() {
  const [, , command, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  switch (command) {
    case 'api': {
      const [method, path] = positional;
      if (!method || !path) die('usage: api <GET|POST|PUT|DELETE> <path> [-f body.json]');
      const body = flags.file ? readBodyFile(flags) : undefined;
      const { json, text } = await gfetch(method.toUpperCase(), path, {
        body,
        flags,
        write: isWriteMethod(method),
      });
      output(json ?? text, flags);
      break;
    }
    case 'query': {
      const [type, expr] = positional;
      if (!type || !expr) die("usage: query <loki|prometheus|tempo> '<expr>'");
      const uid = await resolveDatasourceUid(type, flags);
      const body = buildQueryModel(type, uid, expr, flags);
      const { json } = await gfetch('POST', '/api/ds/query', { body, flags });
      output(json, flags);
      break;
    }
    case 'datasources': {
      const { json } = await gfetch('GET', '/api/datasources', { flags });
      output(json, flags);
      break;
    }
    case 'datasource': {
      const [sub, uid] = positional;
      if (sub === 'get') {
        if (!uid) die('usage: datasource get <uid>');
        const { json } = await gfetch('GET', `/api/datasources/uid/${uid}`, { flags });
        output(json, flags);
      } else if (sub === 'create') {
        const body = readBodyFile(flags);
        const { json } = await gfetch('POST', '/api/datasources', { body, flags, write: true });
        output(json, flags);
      } else {
        die('usage: datasource get <uid> | datasource create -f <def.json>');
      }
      break;
    }
    case 'dashboards': {
      const q = positional[0] ? `?query=${encodeURIComponent(positional[0])}` : '';
      const { json } = await gfetch('GET', `/api/search${q}`, { flags });
      output(json, flags);
      break;
    }
    case 'dashboard': {
      const [sub, uid] = positional;
      if (sub === 'get') {
        if (!uid) die('usage: dashboard get <uid>');
        const { json } = await gfetch('GET', `/api/dashboards/uid/${uid}`, { flags });
        output(json, flags);
      } else if (sub === 'upsert') {
        const model = readBodyFile(flags);
        // Accept either a bare dashboard model or a full {dashboard, ...} payload.
        const body = model.dashboard ? model : { dashboard: model, overwrite: true };
        const { json } = await gfetch('POST', '/api/dashboards/db', { body, flags, write: true });
        output(json, flags);
      } else {
        die('usage: dashboard get <uid> | dashboard upsert -f <model.json>');
      }
      break;
    }
    default:
      die(`unknown command "${command}" (run with no args for help)`);
  }
}

// Only run the CLI when invoked directly — importing for tests must not execute.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => die(e?.message ?? String(e)));
}
