import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitleFile,parseTime,formatTime,combineTracks,findCueIndex,findAdjacentCueIndex,normalizeBilingual} from '../lib/subtitles.js';

test('parses SRT and WebVTT timestamps, retaining multiline dialogue', () => {
  const srt = '1\r\n00:00:01,200 --> 00:00:03,000\r\n<i>Hello</i>\r\nthere\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,500\r\nElizabeth Holmes\r\n';
  assert.deepEqual(parseSubtitleFile(srt), [
    {start:1.2,end:3,text:'Hello\nthere'},
    {start:5,end:6.5,text:'Elizabeth Holmes'}
  ]);
  const vtt = 'WEBVTT\n\n00:01.500 --> 00:03.000 align:start\n第一句\n\n00:04.000 --> 00:05.000\n第二句\n';
  assert.equal(parseSubtitleFile(vtt).length,2);
  assert.equal(parseSubtitleFile(vtt)[0].text,'第一句');
});

test('pairs translated cues by timing and locates dialogue after seeks', () => {
  const en = parseSubtitleFile('1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:06,000\nWorld');
  const zh = parseSubtitleFile('1\n00:00:01,100 --> 00:00:03,100\n你好\n\n2\n00:00:04,100 --> 00:00:06,100\n世界');
  const cues = combineTracks(en,zh);
  assert.equal(cues[1].zh,'世界');
  assert.equal(findCueIndex(cues,2),0);
  assert.equal(findCueIndex(cues,3.5),-1);
  assert.equal(findAdjacentCueIndex(cues,3.5,1),1);
  assert.equal(findAdjacentCueIndex(cues,5,-1),0);
});

test('accepts bilingual JSON and rejects broken timing', () => {
  assert.deepEqual(normalizeBilingual({cues:[{start:1,end:2,en:'Hello',zh:'你好'}]}),[{start:1,end:2,en:'Hello',zh:'你好'}]);
  assert.throws(() => normalizeBilingual([{start:3,end:2,en:'Oops'}]));
  assert.equal(parseTime('01:23:45'),5025);
  assert.equal(formatTime(5025.9),'01:23:45');
});
