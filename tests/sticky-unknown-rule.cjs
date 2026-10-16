// Regression checks for the user's "unknown stays unknown outside unknown-only" rule.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const cache = '20261016-quiet-v4';

function loadProgress() {
  const values = new Map();
  const nodes = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const document = {
    body: { appendChild(node) { nodes.set(node.id, node); } },
    getElementById(id) { return nodes.get(id) || null; },
    createElement(tagName) {
      return {
        tagName,
        style: {},
        dataset: {},
        hidden: false,
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; }
      };
    }
  };
  const window = {
    document,
    setTimeout: () => 1,
    clearTimeout() {}
  };
  // Seed prior data before the shared module creates its one-time backup.
  const legacy = '{"0":"unknown","1":"known"}';
  storage.setItem('handwritten_vocab_179_audio_ipa_v1', legacy);
  const code = fs.readFileSync(path.join(root, 'shared/study-progress.js'), 'utf8');
  vm.runInNewContext(code, { window, localStorage: storage, Date, console, encodeURIComponent }, { filename: 'study-progress.js' });
  return { progress: window.StudyProgress, storage, values, nodes, legacy };
}

test('old progress remains untouched and backup preserves old value', () => {
  const { progress, storage, legacy } = loadProgress();
  assert.equal(storage.getItem('handwritten_vocab_179_audio_ipa_v1'), legacy);
  const backup = JSON.parse(storage.getItem(progress.BACKUP_KEY));
  assert.equal(backup.states['handwriting:all'].raw, legacy);
});

test('unknown flag sticks when marked known in all or unseen mode', () => {
  const { progress, nodes } = loadProgress();
  for (const mode of ['all', 'unseen']) {
    const state = { 0: 'unknown' };
    const result = progress.applyMark(state, 0, 'known', mode, { libraryId: 'high', scope: 'Unit 1' });
    assert.equal(state[0], 'unknown', 'normal mode must never release an unknown mark');
    assert.equal(result.next, 'unknown');
    assert.equal(nodes.size, 0, 'normal review must not show any pop-up/toast');
  }
});

test('unknown-only mode can release words, but snapshot stays fixed', () => {
  const { progress, nodes } = loadProgress();
  const state = { 0: 'unknown', 1: 'unknown', 2: 'known' };
  const locked = progress.createUnknownSnapshot(3, state);
  assert.deepEqual(Array.from(locked), [0, 1]);
  const result = progress.applyMark(state, 0, 'known', 'unknown', { libraryId: 'reading', scope: 'all' });
  assert.equal(result.next, 'known');
  assert.equal(state[0], 'known');
  assert.deepEqual(Array.from(locked), [0, 1], 'current round must keep released words');
  assert.deepEqual(Array.from(progress.createUnknownSnapshot(3, state)), [1], 'new round refreshes');
  assert.equal(nodes.size, 0, 'releasing unknown words must remain silent');
});

test('re-marking unknown wins over a previous known result', () => {
  const { progress } = loadProgress();
  const state = { 0: 'unknown' };
  progress.applyMark(state, 0, 'known', 'unknown', { libraryId: 'reading', scope: 'all' });
  progress.applyMark(state, 0, 'unknown', 'unknown', { libraryId: 'reading', scope: 'all' });
  assert.equal(state[0], 'unknown');
  assert.deepEqual(Array.from(progress.createUnknownSnapshot(1, state)), [0]);
});

test('every review action is silent: unknown, known, protected known and release', () => {
  const { progress, nodes, storage } = loadProgress();
  const state = {};
  const meta = { libraryId: 'handwriting', scope: 'all' };
  progress.applyMark(state, 0, 'unknown', 'all', meta);
  assert.equal(state[0], 'unknown');
  progress.applyMark(state, 0, 'known', 'all', meta);
  assert.equal(state[0], 'unknown');
  progress.applyMark(state, 0, 'known', 'unknown', meta);
  assert.equal(state[0], 'known');
  progress.applyMark(state, 1, 'known', 'all', meta);
  assert.equal(state[1], 'known');
  assert.equal(nodes.size, 0, 'must never append a popup, toast or alert container');
  assert.equal(storage.getItem('handwritten_vocab_179_audio_ipa_v1'), '{"0":"unknown","1":"known"}',
    'shared helper must not modify stored review data until caller explicitly saves');
});

test('normal reset remains immediate; inline hints are unchanged', () => {
  for (const source of [
    'source-pages/cet6-flash-original.html',
    'source-pages/cet6-middle-frequency.html',
    'source-pages/handwriting-original.html',
    'source-pages/reading-original.html'
  ]) {
    const html = fs.readFileSync(path.join(root, source), 'utf8');
    assert.ok(html.includes("localStorage.removeItem(key())"), source + ' should reset in one click');
    assert.ok(!/\\b(?:alert|confirm|prompt)\\s*\\(/.test(html), source + ' must not show a native dialog');
    assert.ok(!html.includes('reviewMarkNotice'), source + ' must not show review toast');
  }
  const shared = fs.readFileSync(path.join(root, 'shared/study-progress.js'), 'utf8');
  assert.ok(!shared.includes('reviewMarkNotice'));
  assert.ok(!shared.includes('showReviewNotice'));
  for (const source of ['source-pages/handwriting-original.html', 'source-pages/reading-original.html']) {
    const html = fs.readFileSync(path.join(root, source), 'utf8');
    assert.ok(html.includes('hintToggle'), source + ' comprehension hint must be retained');
    assert.ok(html.includes('hintNote'), source + ' inline hint note must be retained');
  }
});

test('all four real study pages and three legacy wrappers load the fresh module', () => {
  const sources = [
    'source-pages/cet6-flash-original.html',
    'source-pages/cet6-middle-frequency.html',
    'source-pages/handwriting-original.html',
    'source-pages/reading-original.html'
  ];
  for (const source of sources) {
    const html = fs.readFileSync(path.join(root, source), 'utf8');
    assert.ok(html.includes('study-progress.js?v=' + cache), source);
    assert.ok(html.includes('StudyProgress.applyMark'), source);
    assert.ok(html.includes('unknownSnapshot'), source);
  }
  const wrappers = [
    '六级词汇闪过_前九单元词义终校_补identify版.html',
    '手写单词本_179词_刷词网页_词义核对修正版.html',
    '阅读重点词_28词_刷词网页(1).html'
  ];
  for (const wrapper of wrappers) {
    const html = fs.readFileSync(path.join(root, wrapper), 'utf8');
    assert.ok(html.includes('?v=' + cache), wrapper);
    assert.ok(!html.includes('eval('), wrapper);
  }
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal((index.match(new RegExp('\\?v=' + cache, 'g')) || []).length, 4);
});
