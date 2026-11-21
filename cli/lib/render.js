'use strict';
// Plain-text report for the terminal. Only the aggregate report object is accepted.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function bars(values, labels, width = 30) {
  const max = Math.max(1, ...values);
  const pad = Math.max(...labels.map(l => l.length));
  return values
    .map((v, i) => `  ${labels[i].padStart(pad)} │${'█'.repeat(Math.round((v / max) * width))} ${v}`)
    .join('\n');
}

function table(headers, rows) {
  const cols = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const line = r => r.map((c, i) => (i === 0 ? String(c).padEnd(cols[i]) : String(c).padStart(cols[i]))).join('  ');
  return [line(headers), cols.map(w => '─'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

function renderText(r) {
  const m = r.totals;
  const out = [];
  out.push('PromptLens report', '='.repeat(17), '');
  out.push(`Prompts: ${m.prompts}   Conversations: ${m.conversations}   Active days: ${m.activeDays}   Tools: ${r.perTool.length}`);
  out.push(`Timezone: ${r.timezone}   Prompts without usable timestamps: ${m.undatedPrompts}`, '');
  out.push(`Prompting style: ${r.style.name}`, `  ${r.style.explanation}`, ...r.style.tips.map(t => `  - ${t}`), '');
  out.push('Prompt length', `  Average words: ${m.averageWords}   Median: ${m.medianWords}`, `  Under 10 words: ${m.under10WordsPercent}%   Over 100 words: ${m.over100WordsPercent}%`, '');
  out.push('Habits', `  Question mark: ${m.questionPercent}%   Correction cues: ${m.correctionPercent}%`, `  Fenced code: ${m.codeBlockPercent}%   Prompts per conversation: ${m.averagePromptsPerConversation}`, '');
  out.push('Prompts by hour', bars(m.byHour, Array.from({ length: 24 }, (_, i) => String(i))), '');
  out.push('Prompts by weekday', bars(m.byWeekday, WEEKDAYS), '');
  out.push('Tool comparison', table(
    ['Tool', 'Prompts', 'Convs', 'Days', 'AvgW', 'Median', '<10w%', '>100w%', 'Q%', 'Corr%', 'Code%', 'P/conv'],
    r.perTool.map(t => [t.source, t.prompts, t.conversations, t.activeDays, t.averageWords, t.medianWords, t.under10WordsPercent, t.over100WordsPercent, t.questionPercent, t.correctionPercent, t.codeBlockPercent, t.averagePromptsPerConversation]),
  ), '');
  out.push('How to read this report', ...r.notes.map(n => `  - ${n}`));
  return out.join('\n') + '\n';
}

module.exports = { renderText };
