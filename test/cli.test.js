'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { detect, features, buildReport } = require('../cli/lib/analyze');

const CLI = path.join(__dirname, '..', 'cli', 'index.js');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('detects ChatGPT, Claude.ai, Claude Code and Gemini exports', () => {
  const chatgpt = [{ id: 'a', mapping: { n1: { message: { author: { role: 'user' }, create_time: 1767600000, content: { parts: ['hello there?'] } } } } }];
  const claude = [{ uuid: 'c1', chat_messages: [{ sender: 'human', text: 'fix this again', created_at: '2026-01-05T10:00:00Z' }] }];
  const code = [{ type: 'user', sessionId: 's1', timestamp: '2026-01-05T10:00:00Z', message: { role: 'user', content: 'add a test' } }];
  const gemini = [{ title: 'Prompted what is a CLI?', time: '2026-01-05T10:00:00Z' }];
  assert.strictEqual(detect(JSON.stringify(chatgpt), 'f').source, 'ChatGPT');
  assert.strictEqual(detect(JSON.stringify(claude), 'f').source, 'Claude.ai');
  assert.strictEqual(detect(code.map(r => JSON.stringify(r)).join('\n'), 'f').source, 'Claude Code');
  assert.strictEqual(detect(JSON.stringify(gemini), 'f').source, 'Gemini');
});

test('rejects unknown formats', () => {
  assert.throws(() => detect('[{"foo":1}]', 'f'), /Format not recognized/);
});

test('report contains aggregates only, no prompt text', () => {
  const claude = [{ uuid: 'c1', chat_messages: [{ sender: 'human', text: 'super secret prompt?', created_at: '2026-01-05T10:00:00Z' }] }];
  const rows = detect(JSON.stringify(claude), 'f').prompts.map(features);
  const json = JSON.stringify(buildReport(rows));
  assert.ok(!json.includes('secret'));
  assert.strictEqual(buildReport(rows).totals.prompts, 1);
});

test('cli sample prints a report', () => {
  const r = run('sample');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /PromptLens report/);
});

test('cli analyze reads a folder and writes JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'));
  fs.writeFileSync(path.join(dir, 'conversations.json'), JSON.stringify([{ uuid: 'c1', chat_messages: [{ sender: 'human', text: 'hi', created_at: '2026-01-05T10:00:00Z' }] }]));
  const r = run('analyze', dir, '--json');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(JSON.parse(r.stdout).totals.prompts, 1);
  fs.rmSync(dir, { recursive: true });
});

test('cli reports errors with a non-zero exit code', () => {
  assert.notStrictEqual(run('analyze', 'does-not-exist.json').status, 0);
  assert.notStrictEqual(run('bogus').status, 0);
});
