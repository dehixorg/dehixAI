#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { detect, features, buildReport, sampleRows } = require('./lib/analyze');
const { renderText } = require('./lib/render');

const HELP = `PromptLens CLI: local prompt analytics for ChatGPT, Claude.ai, Claude Code and Gemini exports.

Usage:
  promptlens analyze <file|folder>... [options]
  promptlens sample [options]

Options:
  --json           Print the aggregate report as JSON instead of text
  --out <file>     Write the report to a file instead of the terminal
  -h, --help       Show this help
  -v, --version    Show version

Input: unzipped exports (.json / .jsonl). Folders are searched recursively.
Privacy: files are read locally, nothing is sent anywhere, and only aggregates are output.
`;

function collect(target, found = []) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      collect(path.join(target, name), found);
    }
  } else if (/\.(json|jsonl)$/i.test(target)) {
    found.push(target);
  }
  return found;
}

function parseArgs(argv) {
  const opts = { json: false, out: null, help: false, version: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--out' || a === '-o') {
      opts.out = argv[++i];
      if (!opts.out) throw new Error('--out needs a file name.');
    } else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else opts.positional.push(a);
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.version) { console.log(require('../package.json').version); return 0; }
  const [command, ...targets] = opts.positional;
  if (opts.help || !command) { process.stdout.write(HELP); return opts.help ? 0 : 1; }

  let rows = [];
  if (command === 'sample') {
    rows = sampleRows();
    console.error('Using 96 fictional sample prompts.');
  } else if (command === 'analyze') {
    if (!targets.length) throw new Error('Give at least one file or folder. Example: promptlens analyze conversations.json');
    const files = targets.flatMap(t => {
      if (!fs.existsSync(t)) throw new Error(`Not found: ${t}`);
      return collect(t);
    });
    if (!files.length) throw new Error('No .json or .jsonl files found.');
    files.forEach((file, i) => {
      try {
        const result = detect(fs.readFileSync(file, 'utf8'), `file-${i + 1}`);
        const note = result.badLines ? ` (${result.badLines} malformed lines skipped)` : '';
        console.error(`${path.basename(file)}: ${result.source}, ${result.prompts.length} prompts${note}`);
        rows.push(...result.prompts.map(features));
      } catch (error) {
        console.error(`${path.basename(file)}: skipped. ${error.message}`);
      }
    });
    if (!rows.length) throw new Error('No usable user prompts found in the given files.');
    console.error('Overlapping exports are counted again.');
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  const report = buildReport(rows);
  const output = opts.json ? JSON.stringify(report, null, 2) + '\n' : renderText(report);
  if (opts.out) { fs.writeFileSync(opts.out, output); console.error(`Report written to ${opts.out}`); }
  else process.stdout.write(output);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
