// Tests for the safety-critical pure logic. Run: node --test .claude/skills/grafana/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guard, isLocalhost, isWriteMethod, redact } from './grafana.mjs';

test('isLocalhost: recognizes local hosts', () => {
  assert.equal(isLocalhost('http://localhost:3001'), true);
  assert.equal(isLocalhost('http://127.0.0.1:3001'), true);
  assert.equal(isLocalhost('http://[::1]:3001'), true);
});

test('isLocalhost: rejects remote/invalid hosts', () => {
  assert.equal(isLocalhost('https://grafana.civitai.com'), false);
  assert.equal(isLocalhost('http://10.0.0.5:3000'), false);
  assert.equal(isLocalhost('not-a-url'), false);
});

test('guard: reads always allowed regardless of flags/target', () => {
  assert.equal(guard({ isWrite: false, url: 'https://grafana.civitai.com', writable: false }).ok, true);
  assert.equal(guard({ isWrite: false, url: 'http://localhost:3001', writable: false }).ok, true);
});

test('guard: a query (read over HTTP POST) is allowed without --writable', () => {
  // Regression: /api/ds/query is a POST but semantically a read — must pass.
  assert.equal(guard({ isWrite: false, url: 'http://localhost:3001', writable: false }).ok, true);
});

test('guard: write without --writable is blocked', () => {
  const r = guard({ isWrite: true, url: 'http://localhost:3001', writable: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /--writable/);
});

test('guard: local write with --writable is allowed', () => {
  assert.equal(guard({ isWrite: true, url: 'http://localhost:3001', writable: true }).ok, true);
  assert.equal(guard({ isWrite: true, url: 'http://127.0.0.1:3001', writable: true }).ok, true);
});

test('guard: remote write needs --confirm-prod even with --writable', () => {
  const blocked = guard({ isWrite: true, url: 'https://grafana.civitai.com', writable: true });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /confirm-prod/);
  const allowed = guard({
    isWrite: true,
    url: 'https://grafana.civitai.com',
    writable: true,
    confirmProd: true,
  });
  assert.equal(allowed.ok, true);
});

test('isWriteMethod: GET is read, others are writes', () => {
  assert.equal(isWriteMethod('GET'), false);
  assert.equal(isWriteMethod('get'), false);
  assert.equal(isWriteMethod('POST'), true);
  assert.equal(isWriteMethod('DELETE'), true);
});

test('redact: masks secret-ish keys at any depth, keeps the rest', () => {
  const out = redact({
    name: 'loki',
    basicAuthPassword: 'hunter2',
    secureJsonData: { httpHeaderValue1: 'Bearer x' },
    nested: [{ token: 'abc', kept: 1 }],
    url: 'http://lgtm:3100',
  });
  assert.equal(out.name, 'loki');
  assert.equal(out.url, 'http://lgtm:3100');
  assert.equal(out.basicAuthPassword, '***redacted***');
  assert.equal(out.secureJsonData, '***redacted***');
  assert.equal(out.nested[0].token, '***redacted***');
  assert.equal(out.nested[0].kept, 1);
});
