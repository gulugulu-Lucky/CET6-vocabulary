import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightSpecifier = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : 'playwright';
const { chromium } = await import(playwrightSpecifier);

const ROOT = path.resolve(import.meta.dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'test-results');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const libraries = [
  {
    id: 'high',
    name: '高频词',
    path: '/source-pages/cet6-flash-original.html',
    key: 'cet6_flash_733_audio_ipa_fixed_Unit 1',
    expectedTotal: 733,
    expectedUnits: [82, 83, 82, 82, 82, 81, 77, 81, 83]
  },
  {
    id: 'middle',
    name: '中频词',
    path: '/source-pages/cet6-middle-frequency.html',
    key: 'cet6_middle_frequency_progress_v1_Unit 1',
    expectedTotal: 1005,
    expectedUnits: [84, 85, 84, 85, 85, 85, 84, 85, 78, 81, 84, 85]
  },
  {
    id: 'handwriting',
    name: '手写单词本',
    path: '/手写单词本_179词_刷词网页_词义核对修正版.html',
    key: 'handwritten_vocab_179_audio_ipa_v1',
    expectedTotal: 179,
    wrapper: true
  },
  {
    id: 'reading',
    name: '阅读重点词',
    path: '/阅读重点词_28词_刷词网页(1).html',
    key: 'reading_vocab_28_v1',
    expectedTotal: 28,
    wrapper: true
  }
];
const highCompatibilityWrapper = {
  ...libraries[0],
  name: '高频词兼容入口',
  path: '/六级词汇闪过_前九单元词义终校_补identify版.html',
  wrapper: true
};

function safePath(urlPath) {
  const relative = path.normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '');
  const target = path.resolve(ROOT, relative || 'index.html');
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

const server = http.createServer(async (request, response) => {
  try {
    const parsed = new URL(request.url, 'http://127.0.0.1');
    if (parsed.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    let target = safePath(parsed.pathname);
    if (!target) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
await mkdir(RESULTS_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH || process.platform === 'win32' ? { executablePath: CHROME } : {})
});
const results = [];

function watchPage(page, errors) {
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

async function newContext(viewport = { width: 1280, height: 900 }) {
  const errors = [];
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  context.on('page', page => watchPage(page, errors));
  await context.addInitScript(() => {
    class TestUtterance {
      constructor(text) { this.text = text; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak() {} }
    });
  });
  return { context, errors };
}

async function prepareStorage(context, entries = {}) {
  const page = await context.newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.evaluate(values => {
    localStorage.clear();
    Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
  }, entries);
  await page.close();
}

async function openLibrary(page, library) {
  await page.goto(BASE + encodeURI(library.path), { waitUntil: 'load' });
  if (!library.wrapper) {
    await page.locator('#word').waitFor();
    return page.mainFrame();
  }
  const iframe = page.locator('#vocabPage');
  await iframe.waitFor();
  const frame = await iframe.elementHandle().then(handle => handle.contentFrame());
  assert(frame, `${library.name} iframe 未载入`);
  await frame.locator('#word').waitFor();
  return frame;
}

async function snapshot(surface) {
  return surface.evaluate(() => ({
    mode,
    order: [...order],
    index: idx,
    currentWord: currentItem()?.word || null,
    currentState: state(),
    unknownSnapshot: Array.isArray(globalThis.unknownSnapshot)
      ? [...globalThis.unknownSnapshot]
      : (typeof unknownSnapshot !== 'undefined' && Array.isArray(unknownSnapshot) ? [...unknownSnapshot] : null)
  }));
}

async function mark(surface, value) {
  const button = surface.locator(value === 'known' ? '#yesBtn' : '#noBtn');
  await button.click();
  await button.click();
}

async function setMode(surface, value) {
  await surface.locator(`.chip[data-mode="${value}"]`).click();
}

function assertNoErrors(errors, label) {
  assert.deepEqual(errors, [], `${label} 产生浏览器错误：\n${errors.join('\n')}`);
}

async function run(name, test) {
  const startedAt = Date.now();
  try {
    await test();
    results.push({ name, status: 'passed', durationMs: Date.now() - startedAt });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    results.push({ name, status: 'failed', durationMs: Date.now() - startedAt, error: error.stack || String(error) });
    process.stderr.write(`FAIL ${name}\n${error.stack || error}\n`);
  }
}

await run('首页入口、真实入口、数据总数与发音按钮', async () => {
  const { context, errors } = await newContext();
  try {
    await prepareStorage(context);
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    assert.equal(await page.locator('a[href="study-data.html"]').count(), 1);
    assert.equal(await page.locator('.shelf a').count(), 5, '首页应保留四词库并新增学习数据入口');

    for (const library of libraries) {
      const surface = await openLibrary(page, library);
      const counts = await surface.evaluate(() => {
        if (Array.isArray(DATA)) return { total: DATA.length, units: null };
        const units = Object.values(DATA).map(items => items.length);
        return { total: units.reduce((sum, count) => sum + count, 0), units };
      });
      assert.equal(counts.total, library.expectedTotal, `${library.name} 总词数`);
      if (library.expectedUnits) assert.deepEqual(counts.units, library.expectedUnits, `${library.name} 单元词数`);
      assert(await surface.evaluate(() => Boolean(window.StudyProgress)), `${library.name} 未载入共享进度模块`);
      await surface.locator('#card').click();
      const soundButton = surface.locator('.inline-sound-btn, #inlineSoundBtn').first();
      await soundButton.click();
      if (library.wrapper) {
        assert.equal(await page.locator('#notice').isVisible(), false, `${library.name} wrapper 报错提示不应显示`);
        const hintToggle = surface.locator('#hintToggle');
        if (!await hintToggle.isVisible()) {
          await surface.evaluate(() => {
            const hintedIndex = DATA.findIndex(item => item.hint);
            order = [hintedIndex];
            idx = 0;
            render();
          });
          await surface.locator('#card').click();
        }
        assert.equal(await hintToggle.isVisible(), true, `${library.name} 辅助理解入口应保留`);
        await hintToggle.click();
        assert.equal(await surface.locator('#hintNote').isVisible(), true, `${library.name} 辅助理解内容应可展开`);
        await surface.locator('#hintNote').click();
      }
    }
    assertNoErrors(errors, '真实入口冒烟测试');
  } finally {
    await context.close();
  }
});

await run('旧 localStorage 原值备份且仪表盘不伪造历史日期', async () => {
  const { context, errors } = await newContext();
  try {
    const legacy = {
      'cet6_flash_733_audio_ipa_fixed_Unit 1': JSON.stringify({ 0: 'known', 1: 'unknown', 999: 'known' }),
      'cet6_middle_frequency_progress_v1_Unit 1': JSON.stringify({ 0: 'known' }),
      'cet6_middle_frequency_progress_v1_Unit 12': JSON.stringify({ 0: 'unknown' }),
      'handwritten_vocab_179_audio_ipa_v1': JSON.stringify({ 0: 'known', 1: 'unknown' }),
      'reading_vocab_28_v1': JSON.stringify({ 0: 'unknown', 1: 'known' })
    };
    await prepareStorage(context, legacy);
    const page = await context.newPage();
    await openLibrary(page, libraries[0]);
    const backup = await page.evaluate(() => JSON.parse(localStorage.getItem('cet6_issue7_progress_backup_v1')));
    assert.equal(backup.version, 1);
    assert.equal(backup.states['high:Unit 1'].raw, legacy['cet6_flash_733_audio_ipa_fixed_Unit 1']);
    const migratedHighState = JSON.parse(await page.evaluate(key => localStorage.getItem(key), libraries[0].key));
    assert.equal(migratedHighState[0], 'known');
    assert.equal(migratedHighState[1], 'unknown');

    await page.goto(`${BASE}/study-data.html`);
    const dashboard = await page.evaluate(() => StudyProgress.dashboard());
    assert.deepEqual(
      dashboard.libraries.map(({ reviewed, known, unknown }) => ({ reviewed, known, unknown })),
      [
        { reviewed: 2, known: 1, unknown: 1 },
        { reviewed: 2, known: 1, unknown: 1 },
        { reviewed: 2, known: 1, unknown: 1 },
        { reviewed: 2, known: 1, unknown: 1 }
      ]
    );
    assert.deepEqual(dashboard.overall, { total: 1945, known: 4, unknown: 4, reviewed: 8 });
    assert.equal(dashboard.today, 0);
    assert.equal(dashboard.streak, 0);
    assert.equal(dashboard.garden.wateringDays, 0);
    assert(dashboard.trend.every(day => day.count === 0));
    assertNoErrors(errors, '旧记录回归');
  } finally {
    await context.close();
  }
});

for (const library of libraries) {
  await run(`${library.name}：不会状态优先、锁定轮次、空名单与刷新`, async () => {
    const { context, errors } = await newContext();
    try {
      await prepareStorage(context);
      const page = await context.newPage();
      let surface = await openLibrary(page, library);
      const firstWord = await surface.locator('#word').textContent();

      await mark(surface, 'unknown');
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'unknown');
      assert.equal(await surface.locator('#reviewMarkNotice, [role="alert"], dialog').count(), 0, '不会后不能弹提示');

      await setMode(surface, 'all');
      assert.equal(await surface.locator('#word').textContent(), firstWord);
      await mark(surface, 'known');
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'unknown', '全部模式不能覆盖不会');
      assert.equal(await surface.locator('#reviewMarkNotice, [role="alert"], dialog').count(), 0, '会后不能弹提示');

      await setMode(surface, 'unknown');
      let locked = await snapshot(surface);
      assert.deepEqual(locked.order, [0]);
      await mark(surface, 'known');
      locked = await snapshot(surface);
      assert.equal(locked.currentState[0], 'known');
      assert.equal(await surface.locator('#reviewMarkNotice, [role="alert"], dialog').count(), 0, '只刷不会解除重点也不能弹提示');
      assert.equal(locked.currentWord, firstWord, '本轮锁定名单应继续循环已点会的词');
      assert.deepEqual(locked.order, [0]);

      await mark(surface, 'unknown');
      locked = await snapshot(surface);
      assert.equal(locked.currentState[0], 'unknown', '后点不会应成为最终状态');
      assert.equal(locked.currentWord, firstWord);

      await setMode(surface, 'all');
      await setMode(surface, 'unknown');
      assert.deepEqual((await snapshot(surface)).order, [0], '重新进入应按最新状态创建名单');
      await mark(surface, 'known');
      await setMode(surface, 'all');
      await setMode(surface, 'unknown');
      assert.deepEqual((await snapshot(surface)).order, []);
      assert.match(await surface.locator('#word').textContent(), /没有|暂时/);

      await page.reload({ waitUntil: 'load' });
      surface = library.wrapper
        ? await page.locator('#vocabPage').elementHandle().then(handle => handle.contentFrame())
        : page.mainFrame();
      await surface.locator('#word').waitFor();
      assert.equal((await snapshot(surface)).mode, 'all', '刷新后应退出只刷不会模式');
      await setMode(surface, 'unknown');
      assert.deepEqual((await snapshot(surface)).order, []);

      await setMode(surface, 'unseen');
      const unseen = await snapshot(surface);
      const currentLibraryLength = await surface.evaluate(() => Array.isArray(DATA) ? DATA.length : DATA[currentUnit].length);
      assert.equal(unseen.order.includes(0), false, '只刷未刷应排除已有判断的词');
      assert.equal(unseen.order.length, currentLibraryLength - 1);

      await setMode(surface, 'all');
      await surface.locator('#resetBtn').click();
      assert.equal(await surface.evaluate(key => localStorage.getItem(key), library.key), null, '重置应只清除当前词库记录');
      assert((await snapshot(surface)).order.length > 0);

      const activity = await surface.evaluate(() => StudyProgress.readActivity());
      const today = await surface.evaluate(() => StudyProgress.localDateKey());
      assert.equal(Object.keys(activity.days[today]).length, 1, '同日重复判断同一词只计一次');
      assertNoErrors(errors, `${library.name} 状态回归`);
    } finally {
      await context.close();
    }
  });
}

for (const library of libraries) {
  await run(`${library.name}：不会 → 上一个 → 全部模式再点会 → 重点仍保留`, async () => {
    const { context, errors } = await newContext({ width: 390, height: 844 });
    try {
      await prepareStorage(context);
      const page = await context.newPage();
      const surface = await openLibrary(page, library);
      const firstWord = await surface.locator('#word').textContent();

      await mark(surface, 'unknown');
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'unknown');
      assert.match(await surface.locator('#unknownText').textContent(), /1/);

      await surface.locator('#prevBtn').click();
      assert.equal(await surface.locator('#word').textContent(), firstWord);
      assert.equal(await surface.locator('#meaning').isVisible(), false, '返回上一词时必须先隐藏中文');
      assert.equal(await surface.locator('#ipa').isVisible(), false, '返回上一词时必须先隐藏音标');
      assert.match(await surface.locator('#yesBtn').textContent(), /会，显示意思/, '上一词须从正面重新开始');
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'unknown',
        '上一个只是回看，不能取消刚标记的不会');
      assert.match(await surface.locator('#unknownText').textContent(), /1/);

      // Returning to a word-only card: tap unknown once to reveal, again to save.
      await surface.locator('#noBtn').click();
      assert.equal(await surface.locator('#meaning').isVisible(), true, '返回后点不会应显示释义');
      assert.equal(await surface.locator('#ipa').isVisible(), true, '返回后点不会应显示音标');
      await surface.locator('#noBtn').click();
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'unknown');
      await surface.locator('#prevBtn').click();
      assert.equal(await surface.locator('#word').textContent(), firstWord);
      assert.equal(await surface.locator('#meaning').isVisible(), false, '再次上一词也应隐藏中文');
      assert.equal(await surface.locator('#ipa').isVisible(), false, '再次上一词也应隐藏音标');

      await surface.locator('#yesBtn').click();
      assert.equal(await surface.locator('#meaning').isVisible(), true, '返回后第一下会只揭示意思');
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'unknown',
        '揭示释义不得改变任何学习记录');
      await surface.locator('#yesBtn').click();
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'unknown',
        '普通模式在回看卡片后点会，也必须保留不会');

      await setMode(surface, 'unknown');
      assert.deepEqual((await snapshot(surface)).order, [0], '该词仍须出现在只刷不会列表');
      assert.equal(await surface.locator('#word').textContent(), firstWord);

      await mark(surface, 'known');
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'known',
        '只刷不会才可以把词变为会');
      assert.deepEqual((await snapshot(surface)).order, [0], '当前快照仍保留已掌握的词');

      await surface.locator('#prevBtn').click();
      assert.equal(await surface.locator('#word').textContent(), firstWord);
      assert.equal(await surface.locator('#meaning').isVisible(), false, '只刷不会返回上一词也必须隐藏中文');
      assert.equal(await surface.locator('#ipa').isVisible(), false, '只刷不会返回上一词也必须隐藏音标');
      assert.equal(JSON.parse(await surface.evaluate(key => localStorage.getItem(key), library.key))[0], 'known',
        '上一个也不能悄悄撤销只刷不会中的已掌握标记');
      await setMode(surface, 'all');
      await setMode(surface, 'unknown');
      assert.deepEqual((await snapshot(surface)).order, [], '切换模式后才真正移出不会词库');

      assertNoErrors(errors, `${library.name} 上一个不撤销回归`);
    } finally {
      await context.close();
    }
  });
}

await run('高频词 A/B/C 锁定循环、上一词保留标记与打乱', async () => {
  const library = libraries[0];
  const { context, errors } = await newContext();
  try {
    await prepareStorage(context, { [library.key]: JSON.stringify({ 0: 'unknown', 1: 'unknown', 2: 'unknown' }) });
    const page = await context.newPage();
    let surface = await openLibrary(page, library);
    const words = await surface.evaluate(() => DATA['Unit 1'].slice(0, 3).map(item => item.word));
    await setMode(surface, 'unknown');
    assert.deepEqual((await snapshot(surface)).order, [0, 1, 2]);

    for (const word of words) {
      assert.equal(await surface.locator('#word').textContent(), word);
      await mark(surface, 'known');
    }
    let locked = await snapshot(surface);
    assert.equal(locked.currentWord, words[0]);
    assert.deepEqual(locked.order, [0, 1, 2]);
    assert.deepEqual([locked.currentState[0], locked.currentState[1], locked.currentState[2]], ['known', 'known', 'known']);

    await mark(surface, 'known');
    assert.equal((await snapshot(surface)).currentWord, words[1]);
    await mark(surface, 'unknown');
    locked = await snapshot(surface);
    assert.equal(locked.currentState[1], 'unknown');
    await setMode(surface, 'all');
    await setMode(surface, 'unknown');
    assert.deepEqual((await snapshot(surface)).order, [1], '退出再进入后只应包含 B');

    await surface.evaluate(key => localStorage.setItem(key, JSON.stringify({ 0: 'unknown', 1: 'unknown', 2: 'unknown' })), library.key);
    await page.reload({ waitUntil: 'load' });
    surface = page.mainFrame();
    await setMode(surface, 'unknown');
    await mark(surface, 'known');
    assert.equal((await snapshot(surface)).currentWord, words[1]);
    await surface.locator('#prevBtn').click();
    locked = await snapshot(surface);
    assert.equal(locked.currentWord, words[0]);
    assert.equal(locked.currentState[0], 'known', '上一词只导航，不能撤销已保存的状态');
    assert.deepEqual(locked.order, [0, 1, 2], '上一词不得破坏锁定名单');

    await surface.evaluate(key => localStorage.setItem(key, JSON.stringify({ 0: 'unknown', 1: 'unknown', 2: 'unknown' })), library.key);
    await page.reload({ waitUntil: 'load' });
    surface = page.mainFrame();
    await setMode(surface, 'unknown');
    await surface.evaluate(() => { Math.random = () => 0; });
    await surface.locator('#shuffleBtn').click();
    const shuffled = (await snapshot(surface)).order;
    assert.deepEqual([...shuffled].sort((a, b) => a - b), [0, 1, 2]);
    for (let count = 0; count < 3; count++) await mark(surface, 'known');
    locked = await snapshot(surface);
    assert.equal(locked.currentWord, words[shuffled[0]]);
    assert.deepEqual([locked.currentState[0], locked.currentState[1], locked.currentState[2]], ['known', 'known', 'known']);
    assertNoErrors(errors, 'A/B/C 回归');
  } finally {
    await context.close();
  }
});

await run('高频词和中频词在只刷不会模式切换 Unit 时重建对应名单', async () => {
  const { context, errors } = await newContext();
  try {
    await prepareStorage(context, {
      'cet6_flash_733_audio_ipa_fixed_Unit 2': JSON.stringify({ 0: 'unknown' }),
      'cet6_middle_frequency_progress_v1_Unit 2': JSON.stringify({ 0: 'unknown' })
    });
    const page = await context.newPage();
    for (const library of libraries.slice(0, 2)) {
      const surface = await openLibrary(page, library);
      await surface.locator('#unitSelect').selectOption('Unit 1');
      await setMode(surface, 'unknown');
      assert.deepEqual((await snapshot(surface)).order, []);
      await surface.locator('#unitSelect').selectOption('Unit 2');
      const unitTwo = await snapshot(surface);
      assert.deepEqual(unitTwo.order, [0]);
      assert.equal(unitTwo.currentWord, await surface.evaluate(() => DATA['Unit 2'][0].word));
      await surface.locator('#unitSelect').selectOption('Unit 1');
      assert.deepEqual((await snapshot(surface)).order, []);
    }
    assertNoErrors(errors, 'Unit 切换');
  } finally {
    await context.close();
  }
});

await run('高频词旧 iframe 兼容入口不再覆盖新判断规则', async () => {
  const { context, errors } = await newContext();
  try {
    await prepareStorage(context, { [libraries[0].key]: JSON.stringify({ 0: 'unknown' }) });
    const page = await context.newPage();
    const surface = await openLibrary(page, highCompatibilityWrapper);
    assert.equal(await page.locator('#notice').isVisible(), false);
    await setMode(surface, 'unknown');
    const firstWord = await surface.locator('#word').textContent();
    await mark(surface, 'known');
    const locked = await snapshot(surface);
    assert.equal(locked.currentState[0], 'known');
    assert.equal(locked.currentWord, firstWord, '旧入口也必须保持本轮名单锁定');
    assert.deepEqual(locked.order, [0]);
    assertNoErrors(errors, '高频词兼容入口');
  } finally {
    await context.close();
  }
});

await run('学习事件去重、跨日趋势、连续天数与每日浇水阈值', async () => {
  const { context, errors } = await newContext();
  try {
    await prepareStorage(context);
    const page = await context.newPage();
    const surface = await openLibrary(page, libraries[0]);
    await surface.locator('#card').click();
    assert.equal(await surface.evaluate(() => Object.keys(StudyProgress.readActivity().days).length), 0, '只查看释义不能计入学习事件');
    await surface.locator('#yesBtn').click();
    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.evaluate(() => Object.keys(StudyProgress.readActivity().days).length), 1, '刷新不能重复增加学习事件');
    await page.goto(`${BASE}/study-data.html`);
    assert.equal((await page.evaluate(() => StudyProgress.dashboard())).today, 1, '真实刷词操作应写入今日事件');

    await page.evaluate(() => localStorage.removeItem(StudyProgress.ACTIVITY_KEY));
    const nine = await page.evaluate(() => {
      const first = StudyProgress.recordMark('high', 'Unit 1', 0);
      for (let index = 1; index < 9; index++) StudyProgress.recordMark('high', 'Unit 1', index);
      const duplicate = StudyProgress.recordMark('high', 'Unit 1', 0);
      renderDashboard();
      return { first, duplicate, data: StudyProgress.dashboard() };
    });
    assert.equal(nine.first, true);
    assert.equal(nine.duplicate, false);
    assert.equal(nine.data.today, 9);
    assert.equal(nine.data.garden.wateringDays, 0);
    assert.equal(nine.data.garden.remainingToday, 1);

    const ten = await page.evaluate(() => {
      StudyProgress.recordMark('middle', 'Unit 1', 0);
      renderDashboard();
      return StudyProgress.dashboard();
    });
    assert.equal(ten.today, 10);
    assert.equal(ten.garden.wateredToday, true);
    assert.equal(ten.garden.wateringDays, 1);

    const week = await page.evaluate(() => {
      const today = new Date();
      for (let offset = -6; offset <= -1; offset++) {
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 12);
        StudyProgress.recordMark('reading', 'all', 0, date);
        if (offset === -4 || offset === -2) {
          for (let index = 1; index < 10; index++) StudyProgress.recordMark('high', 'Unit 2', index, date);
        }
      }
      renderDashboard();
      return StudyProgress.dashboard();
    });
    assert.equal(week.streak, 7);
    assert.deepEqual(week.trend.map(day => day.count), [1, 1, 10, 1, 10, 1, 10]);
    assert.equal(week.garden.wateringDays, 3);
    assert.equal(week.garden.stage.name, '长出新叶');
    assert.equal(await page.locator('#trendBars .day').count(), 7);

    await page.screenshot({ path: path.join(RESULTS_DIR, 'issue7-dashboard-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'load' });
    const mobileWidth = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
    assert(mobileWidth.scrollWidth <= mobileWidth.innerWidth + 1, '仪表盘手机端不应横向溢出');
    await page.screenshot({ path: path.join(RESULTS_DIR, 'issue7-dashboard-mobile.png'), fullPage: true });
    assertNoErrors(errors, '仪表盘回归');
  } finally {
    await context.close();
  }
});

await run('四个词库手机一屏布局与真实 wrapper 回归', async () => {
  const { context, errors } = await newContext({ width: 390, height: 844 });
  try {
    await prepareStorage(context, {
      'cet6_flash_733_audio_ipa_fixed_Unit 1': JSON.stringify({ 0: 'unknown', 1: 'unknown' })
    });
    const page = await context.newPage();
    for (const library of libraries) {
      const surface = await openLibrary(page, library);
      const layout = await surface.evaluate(() => {
        const actions = document.querySelector('.actions').getBoundingClientRect();
        return {
          innerWidth,
          innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          actionsTop: actions.top,
          actionsBottom: actions.bottom
        };
      });
      assert(layout.scrollWidth <= layout.innerWidth + 1, `${library.name} 手机端横向溢出`);
      assert(layout.actionsTop >= 0 && layout.actionsBottom <= layout.innerHeight + 1, `${library.name} 操作区未保持在一屏内`);
      assert(layout.scrollHeight <= layout.innerHeight + 2, `${library.name} 页面不应纵向滚动`);
      if (library.wrapper) {
        const outer = await page.evaluate(() => ({ innerHeight, scrollHeight: document.documentElement.scrollHeight }));
        assert(outer.scrollHeight <= outer.innerHeight + 2, `${library.name} 外层 wrapper 不应纵向滚动`);
      }
    }

    const high = await openLibrary(page, libraries[0]);
    await setMode(high, 'unknown');
    await mark(high, 'known');
    assert.equal((await snapshot(high)).currentState[0], 'known');
    assert.equal((await snapshot(high)).currentWord, await high.evaluate(() => DATA['Unit 1'][1].word));
    await mark(high, 'known');
    const fullyKnownLockedRound = await snapshot(high);
    assert.deepEqual([fullyKnownLockedRound.currentState[0], fullyKnownLockedRound.currentState[1]], ['known', 'known']);
    assert.deepEqual(fullyKnownLockedRound.order, [0, 1]);
    assert.equal(fullyKnownLockedRound.currentWord, await high.evaluate(() => DATA['Unit 1'][0].word));
    await page.screenshot({ path: path.join(RESULTS_DIR, 'issue7-locked-round-mobile.png'), fullPage: true });
    assertNoErrors(errors, '手机一屏回归');
  } finally {
    await context.close();
  }
});

const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE,
  browser: 'Google Chrome (Playwright)',
  viewportCoverage: ['1280x900', '390x844'],
  passed: results.filter(item => item.status === 'passed').length,
  failed: results.filter(item => item.status === 'failed').length,
  results
};
await writeFile(path.join(RESULTS_DIR, 'issue7-browser-results.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');

await browser.close();
await new Promise(resolve => server.close(resolve));

process.stdout.write(`\n${summary.passed} passed, ${summary.failed} failed\n`);
if (summary.failed) process.exitCode = 1;
