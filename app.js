import {FILM_DURATION, parseTime, formatTime, parseSubtitleFile, combineTracks, normalizeBilingual, findCueIndex, findAdjacentCueIndex} from './lib/subtitles.js';

const $ = id => document.getElementById(id);
const KEY = 'open-caption-v1';
const state = {english:[],chinese:[],cues:[],offset:0,baseTime:0,baseAt:performance.now(),running:false,dim:false,fontScale:1,wakeEnabled:true,duration:FILM_DURATION};
let lastCue = -2;
let toastTimer;
let wakeLock = null;
let editingTimeline = false;

function getTime() {
  return Math.max(0, Math.min(state.duration, state.baseTime + (state.running ? (performance.now() - state.baseAt) / 1000 : 0) + state.offset));
}
function setTime(time) {
  state.baseTime = Math.max(0, Math.min(state.duration, time)) - state.offset;
  state.baseAt = performance.now();
  render(true);
  persist();
}
function setRunning(running) {
  if (running === state.running) return;
  if (!running) state.baseTime += (performance.now() - state.baseAt) / 1000;
  state.baseAt = performance.now();
  state.running = running;
  $('playText').textContent = running ? '暂停' : '开始';
  $('playIcon').textContent = running ? 'Ⅱ' : '▶';
  $('playPause').setAttribute('aria-label', running ? '暂停计时' : '开始计时');
  if (running) acquireWakeLock(); else releaseWakeLock();
  persist();
}
function changeOffset(amount) {
  state.offset = Math.round((state.offset + amount) * 10) / 10;
  $('offsetDisplay').textContent = `${state.offset > 0 ? '+' : state.offset < 0 ? '−' : '±'}${Math.abs(state.offset).toFixed(1)}s`;
  render(true);
  persist();
  toast(amount > 0 ? `字幕提前 ${amount} 秒` : `字幕延后 ${Math.abs(amount)} 秒`);
}
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 2400);
}
function persist() {
  try {
    const record = {english:state.english,chinese:state.chinese,cues:state.cues,offset:state.offset,time:getTime(),dim:state.dim,fontScale:state.fontScale,wakeEnabled:state.wakeEnabled,duration:state.duration};
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch { $('importMessage').textContent = '本机存储空间不足，刷新页面后字幕可能不会保留。'; }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved) return;
    state.english = Array.isArray(saved.english) ? saved.english : [];
    state.chinese = Array.isArray(saved.chinese) ? saved.chinese : [];
    state.cues = normalizeBilingual(saved.cues || []);
    state.offset = Number(saved.offset) || 0;
    state.baseTime = (Number(saved.time) || 0) - state.offset;
    state.duration = Math.max(FILM_DURATION, Number(saved.duration) || 0);
    state.dim = !!saved.dim;
    state.fontScale = Math.max(.7, Math.min(1.5, Number(saved.fontScale) || 1));
    state.wakeEnabled = saved.wakeEnabled !== false;
  } catch { localStorage.removeItem(KEY); }
}
function updateDataUI() {
  const ready = state.cues.length > 0;
  $('captionArea').classList.toggle('empty', !ready);
  $('emptyState').hidden = ready;
  $('dataStatus').classList.toggle('ready', ready);
  $('dataStatus').lastChild.textContent = ready ? ` ${state.cues.length} 句字幕` : ' 未载入字幕';
  $('prevCue').disabled = !ready;
  $('nextCue').disabled = !ready;
  $('duration').textContent = formatTime(state.duration);
  $('timeline').max = state.duration;
  lastCue = -2;
  render(true);
}
function render(force = false) {
  const time = getTime();
  $('currentTime').textContent = formatTime(time);
  if (!editingTimeline) $('timeline').value = time;
  $('timeline').style.setProperty('--progress', `${(time / state.duration * 100).toFixed(3)}%`);
  const index = findCueIndex(state.cues, time);
  if (!force && index === lastCue) return;
  lastCue = index;
  const ready = state.cues.length > 0;
  $('cueCounter').textContent = ready ? `${index < 0 ? '—' : String(index + 1).padStart(4, '0')} / ${String(state.cues.length).padStart(4, '0')}` : '— / —';
  $('captions').hidden = index < 0;
  $('betweenCues').hidden = !ready || index >= 0;
  if (index >= 0) {
    const cue = state.cues[index];
    $('zhCaption').textContent = cue.zh;
    $('enCaption').textContent = cue.en;
    $('zhCaption').hidden = !cue.zh;
    $('enCaption').hidden = !cue.en;
    $('captionArea').classList.toggle('english-only', !cue.zh);
  }
}
async function readTextFile(file) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  return utf8.includes('\uFFFD') ? new TextDecoder('gb18030').decode(buffer) : utf8;
}
async function loadTrack(file, language) {
  if (!file) return;
  try {
    const cues = parseSubtitleFile(await readTextFile(file));
    if (!cues.length) throw new Error('找不到有效的时间码和字幕');
    state[language] = cues;
    state.cues = combineTracks(state.english, state.chinese);
    state.duration = Math.max(FILM_DURATION, ...state.cues.map(cue => cue.end));
    $(language === 'english' ? 'enFilename' : 'zhFilename').textContent = file.name;
    $('importMessage').textContent = `已载入 ${cues.length} 句${language === 'english' ? '英文' : '中文'}字幕。${state.english.length && state.chinese.length ? '双语已按时间码配对。' : '可继续载入另一种语言。'}`;
    updateDataUI();
    persist();
  } catch (error) { $('importMessage').textContent = `载入失败：${error.message}`; }
}
async function loadJson(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await readTextFile(file));
    state.cues = normalizeBilingual(data);
    if (!state.cues.length) throw new Error('没有有效字幕');
    state.english = [];
    state.chinese = [];
    state.duration = Math.max(FILM_DURATION, Number(data.duration) || 0, ...state.cues.map(cue => cue.end));
    $('enFilename').textContent = '已载入双语 JSON';
    $('zhFilename').textContent = file.name;
    $('importMessage').textContent = `已载入 ${state.cues.length} 句双语字幕。`;
    updateDataUI();
    persist();
  } catch (error) { $('importMessage').textContent = `载入失败：${error.message}`; }
}
async function acquireWakeLock() {
  if (!state.wakeEnabled || !state.running || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Device may refuse low-battery wake locks. */ }
}
async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch { /* Already released by the browser. */ }
  wakeLock = null;
}
function openDialog(dialog) { if (!dialog.open) dialog.showModal(); }
function setupEvents() {
  $('openImportButton').addEventListener('click', () => openDialog($('settingsDialog')));
  $('settingsButton').addEventListener('click', () => openDialog($('settingsDialog')));
  $('playPause').addEventListener('click', () => setRunning(!state.running));
  $('prevCue').addEventListener('click', () => { const i = findAdjacentCueIndex(state.cues, getTime(), -1); if (i >= 0) setTime(state.cues[i].start); });
  $('nextCue').addEventListener('click', () => { const i = findAdjacentCueIndex(state.cues, getTime(), 1); if (i >= 0) setTime(state.cues[i].start); });
  $('delay2').addEventListener('click', () => changeOffset(-2));
  $('delayHalf').addEventListener('click', () => changeOffset(-.5));
  $('advanceHalf').addEventListener('click', () => changeOffset(.5));
  $('advance2').addEventListener('click', () => changeOffset(2));
  $('timeline').addEventListener('pointerdown', () => { editingTimeline = true; });
  $('timeline').addEventListener('input', event => { $('currentTime').textContent = formatTime(Number(event.target.value)); $('timeline').style.setProperty('--progress', `${Number(event.target.value)/state.duration*100}%`); });
  $('timeline').addEventListener('change', event => { editingTimeline = false; setTime(Number(event.target.value)); });
  $('timeline').addEventListener('pointerup', () => { editingTimeline = false; });
  $('jumpButton').addEventListener('click', () => { $('jumpInput').value = formatTime(getTime()); $('jumpError').textContent = ''; openDialog($('jumpDialog')); $('jumpInput').focus(); });
  $('cancelJump').addEventListener('click', () => $('jumpDialog').close());
  $('jumpForm').addEventListener('submit', event => {
    event.preventDefault();
    const value = parseTime($('jumpInput').value);
    if (!Number.isFinite(value) || value > state.duration) { $('jumpError').textContent = '请输入有效时间，例如 01:23:45'; return; }
    setTime(value);
    $('jumpDialog').close();
  });
  $('dimButton').addEventListener('click', () => { state.dim = !state.dim; document.body.classList.toggle('dim', state.dim); $('dimButton').setAttribute('aria-pressed', String(state.dim)); persist(); });
  $('englishFile').addEventListener('change', event => loadTrack(event.target.files[0], 'english'));
  $('chineseFile').addEventListener('change', event => loadTrack(event.target.files[0], 'chinese'));
  $('jsonFile').addEventListener('change', event => loadJson(event.target.files[0]));
  $('fontDown').addEventListener('click', () => changeFont(-.1));
  $('fontUp').addEventListener('click', () => changeFont(.1));
  $('wakeToggle').addEventListener('click', () => { state.wakeEnabled = !state.wakeEnabled; $('wakeToggle').setAttribute('aria-checked', String(state.wakeEnabled)); if (state.wakeEnabled) acquireWakeLock(); else releaseWakeLock(); persist(); });
  $('fullscreenButton').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('此浏览器暂不支持网页全屏'); } });
  $('clearButton').addEventListener('click', () => { state.english=[];state.chinese=[];state.cues=[];state.offset=0;state.baseTime=0;state.baseAt=performance.now();state.duration=FILM_DURATION;setRunning(false);localStorage.removeItem(KEY);$('offsetDisplay').textContent='±0.0s';$('enFilename').textContent='选择 .srt / .vtt';$('zhFilename').textContent='选择 .srt / .vtt';$('importMessage').textContent='本机字幕已清除。';updateDataUI(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquireWakeLock(); });
  window.addEventListener('pagehide', () => persist());
  window.addEventListener('keydown', event => { if (event.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return; if (event.code === 'Space') { event.preventDefault(); setRunning(!state.running); } if (event.code === 'ArrowLeft') setTime(getTime()-5); if (event.code === 'ArrowRight') setTime(getTime()+5); });
}
function changeFont(delta) {
  state.fontScale = Math.max(.7, Math.min(1.5, Math.round((state.fontScale + delta)*10)/10));
  document.documentElement.style.setProperty('--caption-scale', state.fontScale);
  $('fontValue').textContent = `${Math.round(state.fontScale*100)}%`;
  persist();
}
function loop() { if (state.running) render(); requestAnimationFrame(loop); }

restore();
setupEvents();
document.documentElement.style.setProperty('--caption-scale', state.fontScale);
$('fontValue').textContent = `${Math.round(state.fontScale*100)}%`;
$('wakeToggle').setAttribute('aria-checked', String(state.wakeEnabled));
$('offsetDisplay').textContent = `${state.offset > 0 ? '+' : state.offset < 0 ? '−' : '±'}${Math.abs(state.offset).toFixed(1)}s`;
document.body.classList.toggle('dim', state.dim);
$('dimButton').setAttribute('aria-pressed', String(state.dim));
updateDataUI();
loop();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
