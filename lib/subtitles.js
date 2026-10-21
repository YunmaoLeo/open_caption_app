export const FILM_DURATION = 175 * 60;

export function parseTime(value) {
  const match = String(value).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?$/);
  if (!match) return NaN;
  const [, hours = '0', minutes, seconds, millis = '0'] = match;
  if (+minutes >= 60 || +seconds >= 60) return NaN;
  return +hours * 3600 + +minutes * 60 + +seconds + +(millis.padEnd(3, '0')) / 1000;
}

export function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
}

function plainText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

export function parseSubtitleFile(text) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.replace(/^WEBVTT[^\n]*\n(?:[^\n]*\n)*?\n/i, '').split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeIndex = lines.findIndex(line => line.includes('-->'));
    if (timeIndex < 0) continue;
    const times = lines[timeIndex].match(/(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})/);
    if (!times) continue;
    const start = parseTime(times[1]);
    const end = parseTime(times[2]);
    const caption = plainText(lines.slice(timeIndex + 1).join('\n'));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && caption) cues.push({start, end, text:caption});
  }
  return cues.sort((a,b) => a.start - b.start);
}

export function combineTracks(english = [], chinese = []) {
  if (!english.length) return chinese.map(cue => ({start:cue.start,end:cue.end,en:'',zh:cue.text}));
  return english.map((cue, index) => {
    const matches = chinese.filter(zh => Math.min(cue.end, zh.end) - Math.max(cue.start, zh.start) > .12);
    let zh = matches.map(match => match.text).join('\n');
    if (!zh && chinese.length === english.length) {
      const counterpart = chinese[index];
      if (Math.abs(counterpart.start - cue.start) < 3) zh = counterpart.text;
    }
    return {start:cue.start,end:cue.end,en:cue.text,zh};
  });
}

export function normalizeBilingual(input) {
  const raw = Array.isArray(input) ? input : input?.cues;
  if (!Array.isArray(raw)) throw new Error('JSON 需要 cues 数组');
  const cues = raw.map((cue, index) => {
    const start = Number(cue.start);
    const end = Number(cue.end);
    const en = plainText(cue.en ?? cue.english ?? '');
    const zh = plainText(cue.zh ?? cue.chinese ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || (!en && !zh)) {
      throw new Error(`第 ${index + 1} 句字幕格式不正确`);
    }
    return {start,end,en,zh};
  });
  return cues.sort((a,b) => a.start - b.start);
}

export function findCueIndex(cues, time) {
  let low = 0, high = cues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (cues[mid].start <= time) low = mid + 1;
    else high = mid;
  }
  const index = low - 1;
  return index >= 0 && time < cues[index].end ? index : -1;
}

export function findAdjacentCueIndex(cues, time, direction) {
  if (!cues.length) return -1;
  const current = findCueIndex(cues, time);
  if (direction > 0) {
    if (current >= 0) return Math.min(cues.length - 1, current + 1);
    return Math.min(cues.length - 1, cues.findIndex(cue => cue.start > time) >= 0 ? cues.findIndex(cue => cue.start > time) : cues.length - 1);
  }
  if (current >= 0) return Math.max(0, current - 1);
  for (let i = cues.length - 1; i >= 0; i--) if (cues[i].start < time) return i;
  return 0;
}
