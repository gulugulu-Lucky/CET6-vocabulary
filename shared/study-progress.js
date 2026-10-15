(function (global) {
  'use strict';

  const ACTIVITY_KEY = 'cet6_study_activity_v1';
  const BACKUP_KEY = 'cet6_issue7_progress_backup_v1';

  const catalog = Object.freeze([
    Object.freeze({
      id: 'high', name: '高频词汇', icon: '📘', type: 'units',
      prefix: 'cet6_flash_733_audio_ipa_fixed_',
      units: Object.freeze({
        'Unit 1': 82, 'Unit 2': 83, 'Unit 3': 82, 'Unit 4': 82, 'Unit 5': 82,
        'Unit 6': 81, 'Unit 7': 77, 'Unit 8': 81, 'Unit 9': 83
      })
    }),
    Object.freeze({
      id: 'middle', name: '中频词汇', icon: '📗', type: 'units',
      prefix: 'cet6_middle_frequency_progress_v1_',
      units: Object.freeze({
        'Unit 1': 84, 'Unit 2': 85, 'Unit 3': 84, 'Unit 4': 85, 'Unit 5': 85,
        'Unit 6': 85, 'Unit 7': 84, 'Unit 8': 85, 'Unit 9': 78, 'Unit 10': 81,
        'Unit 11': 84, 'Unit 12': 85
      })
    }),
    Object.freeze({
      id: 'handwriting', name: '手写单词本', icon: '✍️', type: 'flat',
      key: 'handwritten_vocab_179_audio_ipa_v1', total: 179
    }),
    Object.freeze({
      id: 'reading', name: '阅读重点词', icon: '🌷', type: 'flat',
      key: 'reading_vocab_28_v1', total: 28
    })
  ]);

  function safeParse(raw, fallback) {
    if (typeof raw !== 'string') return fallback;
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function shiftLocalDate(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
  }

  function readActivity() {
    const stored = safeParse(localStorage.getItem(ACTIVITY_KEY), null);
    if (!stored || stored.version !== 1 || !stored.days || typeof stored.days !== 'object') {
      return { version: 1, startedAt: null, days: {} };
    }
    return stored;
  }

  function activityEntryId(libraryId, scope, dataIndex) {
    return `${libraryId}:${encodeURIComponent(scope || 'all')}:${dataIndex}`;
  }

  function recordMark(libraryId, scope, dataIndex, at = new Date()) {
    if (!Number.isInteger(dataIndex) || dataIndex < 0) return false;
    const activity = readActivity();
    const day = localDateKey(at);
    const entryId = activityEntryId(libraryId, scope, dataIndex);
    const entries = activity.days[day] && typeof activity.days[day] === 'object'
      ? activity.days[day]
      : {};
    const isNew = !Object.prototype.hasOwnProperty.call(entries, entryId);
    entries[entryId] = 1;
    activity.days[day] = entries;
    if (!activity.startedAt) activity.startedAt = new Date().toISOString();
    try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity)); } catch {}
    return isNew;
  }

  function resolveMark(previous, requested, mode) {
    if (requested === 'unknown') return 'unknown';
    if (requested !== 'known') return previous ?? null;
    if (previous === 'unknown' && mode !== 'unknown') return 'unknown';
    return 'known';
  }

  let noticeTimer = null;

  // Keep the original progress values intact and explain sticky marks at the
  // point of interaction, so mobile Safari users can verify what happened.
  function showReviewNotice(message, kind) {
    if (!global.document || !global.document.body) return;
    let node = global.document.getElementById('reviewMarkNotice');
    if (!node) {
      node = global.document.createElement('div');
      node.id = 'reviewMarkNotice';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.style.cssText = [
        'position:fixed',
        'z-index:1000',
        'left:12px',
        'right:12px',
        'bottom:calc(100px + env(safe-area-inset-bottom))',
        'width:max-content',
        'max-width:calc(100% - 24px)',
        'margin:0 auto',
        'padding:10px 15px',
        'border-radius:15px',
        'background:rgba(37,48,71,.96)',
        'color:#fff',
        'box-shadow:0 8px 25px rgba(37,48,71,.2)',
        'font:600 13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
        'text-align:center',
        'pointer-events:none',
        'white-space:normal'
      ].join(';');
      global.document.body.appendChild(node);
    }
    node.dataset.kind = kind;
    node.textContent = message;
    node.hidden = false;
    if (noticeTimer != null) global.clearTimeout(noticeTimer);
    noticeTimer = global.setTimeout(() => { node.hidden = true; }, 2400);
  }

  function applyMark(state, dataIndex, requested, mode, meta) {
    const previous = state[dataIndex] ?? null;
    const next = resolveMark(previous, requested, mode);
    if (next) state[dataIndex] = next;
    recordMark(meta.libraryId, meta.scope, dataIndex);
    if (requested === 'known' && previous === 'unknown') {
      if (mode === 'unknown') {
        showReviewNotice('✅ 本轮仍会继续刷；离开「只刷不会」后才更新名单', 'released');
      } else {
        showReviewNotice('📌 仍保留在「不会」词库；只有在「只刷不会」里点会才能移出', 'protected');
      }
    } else if (requested === 'unknown' && previous !== 'unknown') {
      showReviewNotice('📌 已加入「不会」词库', 'added');
    }
    return { previous, next };
  }

  function createUnknownSnapshot(length, state) {
    return Array.from({ length }, (_, index) => index).filter(index => state[index] === 'unknown');
  }

  function progressKeys() {
    const keys = [];
    catalog.forEach(library => {
      if (library.type === 'units') {
        Object.keys(library.units).forEach(unit => keys.push({ id: `${library.id}:${unit}`, key: library.prefix + unit }));
      } else {
        keys.push({ id: `${library.id}:all`, key: library.key });
      }
    });
    return keys;
  }

  function ensureProgressBackup() {
    try {
      if (localStorage.getItem(BACKUP_KEY)) return;
      const states = {};
      progressKeys().forEach(item => { states[item.id] = { key: item.key, raw: localStorage.getItem(item.key) }; });
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), states }));
    } catch {}
  }

  function countState(raw, total) {
    const state = safeParse(raw, {});
    let known = 0;
    let unknown = 0;
    Object.entries(state).forEach(([rawIndex, value]) => {
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index < 0 || index >= total) return;
      if (value === 'known') known++;
      if (value === 'unknown') unknown++;
    });
    return { known, unknown, reviewed: known + unknown };
  }

  function libraryStats(library) {
    let total = 0;
    let known = 0;
    let unknown = 0;
    if (library.type === 'units') {
      Object.entries(library.units).forEach(([unit, count]) => {
        const stats = countState(localStorage.getItem(library.prefix + unit), count);
        total += count;
        known += stats.known;
        unknown += stats.unknown;
      });
    } else {
      const stats = countState(localStorage.getItem(library.key), library.total);
      total = library.total;
      known = stats.known;
      unknown = stats.unknown;
    }
    return { id: library.id, name: library.name, icon: library.icon, total, known, unknown, reviewed: known + unknown };
  }

  function recentDays(count = 7, now = new Date()) {
    const activity = readActivity();
    return Array.from({ length: count }, (_, offset) => {
      const date = shiftLocalDate(now, offset - count + 1);
      const key = localDateKey(date);
      const entries = activity.days[key];
      return {
        key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        weekday: '日一二三四五六'[date.getDay()],
        count: entries && typeof entries === 'object' ? Object.keys(entries).length : 0
      };
    });
  }

  function streak(now = new Date()) {
    const activity = readActivity();
    let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const todayCount = Object.keys(activity.days[localDateKey(cursor)] || {}).length;
    if (!todayCount) cursor = shiftLocalDate(cursor, -1);
    let days = 0;
    while (Object.keys(activity.days[localDateKey(cursor)] || {}).length > 0) {
      days++;
      cursor = shiftLocalDate(cursor, -1);
    }
    return days;
  }

  function garden(now = new Date()) {
    const activity = readActivity();
    const wateringDays = Object.values(activity.days).filter(entries => entries && Object.keys(entries).length >= 10).length;
    const todayCount = Object.keys(activity.days[localDateKey(now)] || {}).length;
    const stages = [
      { min: 0, icon: '🫘', name: '一颗种子' },
      { min: 1, icon: '🌱', name: '冒出嫩芽' },
      { min: 2, icon: '🌿', name: '长出新叶' },
      { min: 4, icon: '🌷', name: '含苞待放' },
      { min: 7, icon: '🌸', name: '小花盛开' }
    ];
    const reachedStages = stages.filter(item => wateringDays >= item.min);
    const stage = reachedStages[reachedStages.length - 1];
    return {
      stage,
      wateringDays,
      todayCount,
      threshold: 10,
      wateredToday: todayCount >= 10,
      remainingToday: Math.max(0, 10 - todayCount)
    };
  }

  function dashboard(now = new Date()) {
    const libraries = catalog.map(libraryStats);
    const overall = libraries.reduce((sum, item) => ({
      total: sum.total + item.total,
      known: sum.known + item.known,
      unknown: sum.unknown + item.unknown,
      reviewed: sum.reviewed + item.reviewed
    }), { total: 0, known: 0, unknown: 0, reviewed: 0 });
    const trend = recentDays(7, now);
    return { libraries, overall, trend, today: trend[trend.length - 1].count, streak: streak(now), garden: garden(now), activity: readActivity() };
  }

  ensureProgressBackup();

  global.StudyProgress = Object.freeze({
    ACTIVITY_KEY,
    BACKUP_KEY,
    catalog,
    localDateKey,
    readActivity,
    recordMark,
    resolveMark,
    applyMark,
    createUnknownSnapshot,
    ensureProgressBackup,
    dashboard,
    garden
  });
})(window);
