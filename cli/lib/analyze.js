'use strict';
// Core analysis for the PromptLens CLI. Mirrors the parsers and rules in web/index.html.
// Only aggregates leave this module: raw prompt text is dropped after features() runs.

const SOURCES = ['ChatGPT', 'Claude.ai', 'Claude Code', 'Gemini'];

function textBlocks(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map(p => (typeof p === 'string' ? p : p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n');
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const d = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function normalized(source, time, text, id) {
  return { source, timestamp: timestamp(time), text, conversationId: String(id) };
}

function parseChatGPT(data, context) {
  if (!Array.isArray(data) || !data.some(c => c?.mapping && typeof c.mapping === 'object')) return null;
  const out = [];
  data.forEach((c, i) => {
    try {
      Object.values(c.mapping || {}).forEach(node => {
        try {
          const m = node?.message;
          if (m?.author?.role !== 'user') return;
          const text = textBlocks(m.content?.parts);
          if (text.trim()) out.push(normalized('ChatGPT', m.create_time, text, c.id || c.conversation_id || `${context}:${i}`));
        } catch {}
      });
    } catch {}
  });
  return out;
}

function parseClaude(data, context) {
  if (!Array.isArray(data) || !data.some(c => Array.isArray(c?.chat_messages))) return null;
  const out = [];
  data.forEach((c, i) => {
    try {
      c.chat_messages.forEach(m => {
        try {
          if (m?.sender !== 'human') return;
          const text = typeof m.text === 'string' ? m.text : textBlocks(m.content);
          if (text.trim()) out.push(normalized('Claude.ai', m.created_at, text, c.uuid || c.id || `${context}:${i}`));
        } catch {}
      });
    } catch {}
  });
  return out;
}

function parseClaudeCode(data, context) {
  if (!Array.isArray(data) || !data.some(r => r?.type === 'user' && r?.message?.role === 'user')) return null;
  const out = [];
  data.forEach(r => {
    try {
      if (r?.type !== 'user' || r.message?.role !== 'user' || r.isMeta) return;
      const text = textBlocks(r.message.content); // tool results / images are not prompts
      if (text.trim()) out.push(normalized('Claude Code', r.timestamp, text, r.sessionId || context));
    } catch {}
  });
  return out;
}

function parseGemini(data, context) {
  const isPrompt = r => typeof r?.title === 'string' && /^Prompted(?:\s|$)/.test(r.title);
  if (!Array.isArray(data) || !data.some(isPrompt)) return null;
  const out = [];
  data.forEach((r, i) => {
    try {
      if (!isPrompt(r)) return;
      const text = r.title.replace(/^Prompted\s*/, '');
      if (text.trim()) out.push(normalized('Gemini', r.time, text, r.conversationId || `${context}:activity:${i}`));
    } catch {}
  });
  return out;
}

const PARSERS = [parseChatGPT, parseClaude, parseClaudeCode, parseGemini];

function detect(raw, context) {
  let data;
  let badLines = 0;
  const text = raw.replace(/^\uFEFF/, '');
  try {
    data = JSON.parse(text);
  } catch {
    data = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { data.push(JSON.parse(line)); } catch { badLines++; }
    }
  }
  if (!Array.isArray(data) && data?.type) data = [data];
  for (let i = 0; i < PARSERS.length; i++) {
    try {
      const prompts = PARSERS[i](data, context);
      if (prompts !== null) return { prompts, source: SOURCES[i], badLines };
    } catch {}
  }
  throw new Error('Format not recognized. Use an unzipped export from a supported tool.');
}

function features(p) {
  const words = p.text.trim().split(/\s+/u).length;
  const date = p.timestamp ? new Date(p.timestamp) : null;
  return {
    source: p.source,
    conversationId: p.conversationId,
    words,
    question: p.text.includes('?'),
    correction: /\b(?:no|wrong|fix|still|again|that['’]s\s+not)\b/i.test(p.text),
    code: /```[\s\S]*?```|~~~[\s\S]*?~~~/u.test(p.text),
    day: date ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : null,
    hour: date ? date.getHours() : null,
    weekday: date ? date.getDay() : null,
  };
}

const round = n => Math.round(n * 10) / 10;

function summarize(rows) {
  const n = rows.length;
  const lengths = rows.map(p => p.words).sort((a, b) => a - b);
  const conversations = new Set(rows.map(p => JSON.stringify([p.source, p.conversationId]))).size;
  const percent = predicate => (n ? round((100 * rows.filter(predicate).length) / n) : 0);
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  rows.forEach(p => { if (p.day !== null) { hours[p.hour]++; weekdays[p.weekday]++; } });
  return {
    prompts: n,
    conversations,
    activeDays: new Set(rows.map(p => p.day).filter(Boolean)).size,
    averageWords: n ? round(lengths.reduce((a, b) => a + b, 0) / n) : 0,
    medianWords: n ? (lengths[Math.floor((n - 1) / 2)] + lengths[Math.floor(n / 2)]) / 2 : 0,
    under10WordsPercent: percent(p => p.words < 10),
    over100WordsPercent: percent(p => p.words > 100),
    questionPercent: percent(p => p.question),
    correctionPercent: percent(p => p.correction),
    codeBlockPercent: percent(p => p.code),
    averagePromptsPerConversation: conversations ? round(n / conversations) : 0,
    undatedPrompts: rows.filter(p => p.day === null).length,
    byHour: hours,
    byWeekday: weekdays,
  };
}

function styleFor(m) {
  if (m.codeBlockPercent >= 20 || m.correctionPercent >= 30)
    return { name: 'Debugger', explanation: 'At least 20% of prompts contain fenced code or 30% use correction cues.', tips: ['Include the expected result and the actual result.', 'Share a minimal reproducible example and the exact error.'] };
  if (m.averageWords >= 60 || m.over100WordsPercent >= 20)
    return { name: 'Architect', explanation: 'Your prompts average at least 60 words, or at least 20% exceed 100 words.', tips: ['Separate goals, constraints, and acceptance criteria.', 'Ask for a brief plan before a large implementation.'] };
  if (m.under10WordsPercent >= 50)
    return { name: 'Rapid Iterator', explanation: 'At least half of your prompts are shorter than 10 words.', tips: ['State the goal and essential context in your first prompt.', 'Make each follow-up name the specific change you want.'] };
  return { name: 'Explorer', explanation: 'Your prompts fit a mixed, exploratory pattern under these simple rules.', tips: ['Ask for concrete examples and counterexamples.', 'Specify how you will judge a useful answer.'] };
}

function buildReport(rows) {
  const totals = summarize(rows);
  return {
    version: 1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time',
    notes: [
      'User text only; words are whitespace-separated tokens.',
      'Missing or invalid timestamps are excluded from activity and active days.',
      'Gemini activities without conversation IDs count as separate proxy conversations.',
      'Repeated or overlapping exports are not deduplicated. ChatGPT mapping branches are included.',
      'Correction cues and style rules are English heuristics, not a quality score. Style precedence: Debugger, Architect, Rapid Iterator, Explorer.',
    ],
    totals,
    perTool: SOURCES.filter(s => rows.some(p => p.source === s)).map(source => ({ source, ...summarize(rows.filter(p => p.source === source)) })),
    style: styleFor(totals),
  };
}

// Fictional data, same shape as the web app's "sample data" button.
function sampleRows() {
  const rows = [];
  SOURCES.forEach((source, s) => {
    for (let i = 0; i < 24; i++) {
      const text = [
        'Could you explain this idea with an example?',
        'Again, fix this.\n```js\nconst total = 1;\n```',
        'Create a plan with clear goals. ' + 'Describe each step and its constraints. '.repeat(18),
        'Make it shorter.',
      ][(i + s) % 4];
      rows.push(features(normalized(source, new Date(2026, 0, 5 + (i % 12), 8 + ((i * 3 + s) % 14)).toISOString(), text, `sample-${s}-${Math.floor(i / 4)}`)));
    }
  });
  return rows;
}

module.exports = { SOURCES, PARSERS, detect, features, summarize, styleFor, buildReport, sampleRows, normalized };
