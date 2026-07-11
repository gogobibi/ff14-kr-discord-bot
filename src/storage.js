import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB_PATH = 'data/events.db';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    url TEXT,
    image_url TEXT,
    category TEXT,
    is_welcome INTEGER DEFAULT 0,
    notified_1day INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    notify_channel_id TEXT,
    added_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS notification_log (
    guild_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, event_id, kind)
  );
`;

let db;

function migrate() {
  const cols = db.prepare("PRAGMA table_info(events)").all();
  if (!cols.find((c) => c.name === 'is_welcome')) {
    db.exec("ALTER TABLE events ADD COLUMN is_welcome INTEGER DEFAULT 0");
    // heuristic backfill — LLM 호출 0건. 이후 분류기가 정확한 값으로 갱신.
    db.exec(
      "UPDATE events SET is_welcome = 1 WHERE title LIKE '%복귀%' OR title LIKE '%신규%'",
    );
  }
  // 글로벌 flag (notified_1day, notified_d0) → 길드별 ledger backfill. 멱등 (PK 충돌 시 IGNORE).
  db.exec(`
    INSERT OR IGNORE INTO notification_log (guild_id, event_id, kind)
    SELECT gc.guild_id, e.id, 'd1'
    FROM events e CROSS JOIN guild_config gc
    WHERE e.notified_1day = 1 AND gc.notify_channel_id IS NOT NULL
  `);
  if (cols.find((c) => c.name === 'notified_d0')) {
    db.exec(`
      INSERT OR IGNORE INTO notification_log (guild_id, event_id, kind)
      SELECT gc.guild_id, e.id, 'd0'
      FROM events e CROSS JOIN guild_config gc
      WHERE e.notified_d0 = 1 AND gc.notify_channel_id IS NOT NULL
    `);
  }
  // 과거 분리 kind ('d1'/'d0') 를 단일 'ending' 으로 통합. 이미 알림이 나간 이벤트가
  // 통합 후 재발송되는 것을 방지한다. 멱등 (PK 충돌 시 IGNORE).
  db.exec(`
    INSERT OR IGNORE INTO notification_log (guild_id, event_id, kind, sent_at)
    SELECT guild_id, event_id, 'ending', MIN(sent_at)
    FROM notification_log
    WHERE kind IN ('d1', 'd0')
    GROUP BY guild_id, event_id
  `);
}

export function initDB(dbPath = DEFAULT_DB_PATH) {
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  migrate();
  return db;
}

function ensureDB() {
  if (!db) throw new Error('DB not initialized. Call initDB() first.');
}

function kstDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
}

function todayKST() {
  return kstDate();
}

function tomorrowKST() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return kstDate(d);
}

export function getEvent(id) {
  ensureDB();
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

export function getAllEvents() {
  ensureDB();
  return db.prepare('SELECT * FROM events ORDER BY end_date ASC').all();
}

export function getActiveEvents() {
  ensureDB();
  const today = todayKST();
  return db
    .prepare(
      'SELECT * FROM events WHERE start_date <= ? AND end_date >= ? ORDER BY end_date ASC'
    )
    .all(today, today);
}

export function getEventsByCategory(category) {
  ensureDB();
  const today = todayKST();
  return db
    .prepare(
      'SELECT * FROM events WHERE category = ? AND start_date <= ? AND end_date >= ? ORDER BY end_date ASC'
    )
    .all(category, today, today);
}

export function getCurrentEvents() {
  ensureDB();
  const today = todayKST();
  return db
    .prepare(
      `SELECT * FROM events
       WHERE start_date <= ? AND end_date >= ?
         AND julianday(end_date) - julianday(?) < 365
         AND (category IS NULL OR category != 'permanent')
       ORDER BY end_date ASC`
    )
    .all(today, today, today);
}

export function getLongTermEvents() {
  ensureDB();
  const today = todayKST();
  return db
    .prepare(
      `SELECT * FROM events
       WHERE start_date <= ? AND end_date >= ?
         AND (category = 'permanent' OR julianday(end_date) - julianday(?) >= 365)
       ORDER BY end_date ASC`
    )
    .all(today, today, today);
}

export function getPastEvents() {
  ensureDB();
  const today = todayKST();
  return db
    .prepare('SELECT * FROM events WHERE end_date < ? ORDER BY end_date DESC')
    .all(today);
}

export function getUnclassifiedEvents() {
  ensureDB();
  return db.prepare('SELECT * FROM events WHERE category IS NULL').all();
}

export function upsertEvent(event) {
  ensureDB();
  return db
    .prepare(
      `INSERT INTO events (id, title, description, start_date, end_date, url, image_url, updated_at)
       VALUES (@id, @title, @description, @start_date, @end_date, @url, @image_url, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         start_date = excluded.start_date,
         end_date = excluded.end_date,
         url = excluded.url,
         image_url = excluded.image_url,
         updated_at = datetime('now')`
    )
    .run(event);
}

export function getEventsEndingToday() {
  ensureDB();
  const today = todayKST();
  return db
    .prepare('SELECT * FROM events WHERE end_date = ?')
    .all(today);
}

export function getEventsEndingTomorrow() {
  ensureDB();
  const tomorrow = tomorrowKST();
  return db
    .prepare('SELECT * FROM events WHERE end_date = ?')
    .all(tomorrow);
}

export function hasNotified(guild_id, event_id, kind) {
  ensureDB();
  const row = db
    .prepare(
      'SELECT 1 FROM notification_log WHERE guild_id = ? AND event_id = ? AND kind = ?',
    )
    .get(guild_id, event_id, kind);
  return !!row;
}

export function markNotified(guild_id, event_id, kind) {
  ensureDB();
  return db
    .prepare(
      `INSERT OR IGNORE INTO notification_log (guild_id, event_id, kind, sent_at)
       VALUES (?, ?, ?, datetime('now'))`,
    )
    .run(guild_id, event_id, kind);
}

export function upsertGuildConfig({ guild_id, notify_channel_id }) {
  ensureDB();
  return db
    .prepare(
      `INSERT INTO guild_config (guild_id, notify_channel_id, added_at, updated_at)
       VALUES (@guild_id, @notify_channel_id, datetime('now'), datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         notify_channel_id = excluded.notify_channel_id,
         updated_at = datetime('now')`
    )
    .run({ guild_id, notify_channel_id });
}

export function ensureGuildConfig(guild_id) {
  ensureDB();
  return db
    .prepare(
      `INSERT OR IGNORE INTO guild_config (guild_id, notify_channel_id, added_at, updated_at)
       VALUES (?, NULL, datetime('now'), datetime('now'))`
    )
    .run(guild_id);
}

export function setNotifyChannel(guild_id, channel_id) {
  ensureDB();
  return db
    .prepare(
      `INSERT INTO guild_config (guild_id, notify_channel_id, added_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         notify_channel_id = excluded.notify_channel_id,
         updated_at = datetime('now')`
    )
    .run(guild_id, channel_id);
}

export function getGuildConfig(guild_id) {
  ensureDB();
  return db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guild_id);
}

export function getAllGuildConfigs() {
  ensureDB();
  return db
    .prepare('SELECT * FROM guild_config WHERE notify_channel_id IS NOT NULL')
    .all();
}

export function removeGuildConfig(guild_id) {
  ensureDB();
  return db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(guild_id);
}

export function pruneStaleGuildConfigs(activeGuildIds) {
  ensureDB();
  const stored = db
    .prepare('SELECT guild_id FROM guild_config')
    .all()
    .map((r) => r.guild_id);
  const stale = stored.filter((id) => !activeGuildIds.has(id));
  const stmt = db.prepare('DELETE FROM guild_config WHERE guild_id = ?');
  for (const id of stale) stmt.run(id);
  return stale;
}

export function updateEventClassification(id, category, isWelcome) {
  ensureDB();
  return db
    .prepare(
      "UPDATE events SET category = ?, is_welcome = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .run(category, isWelcome ? 1 : 0, id);
}

export function getLastEventUpdate() {
  ensureDB();
  const row = db.prepare('SELECT MAX(updated_at) AS last FROM events').get();
  return row?.last ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const TEST_DB = 'data/events.test.db';

  const results = { pass: 0, fail: 0 };
  const check = (cond, label, reason = '') => {
    if (cond) {
      console.log(`PASS: ${label}`);
      results.pass++;
    } else {
      console.log(`FAIL: ${label} ${reason}`);
      results.fail++;
    }
  };

  const resetDB = () => {
    if (db) {
      db.close();
      db = undefined;
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = TEST_DB + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    initDB(TEST_DB);
  };

  const addDaysKST = (yyyymmdd, days) => {
    const [y, m, d] = yyyymmdd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days, 3, 0, 0));
    return kstDate(dt);
  };

  const sample = (over = {}) => ({
    id: 'evt-1',
    title: '샘플 이벤트',
    description: '설명',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    url: 'https://www.ff14.co.kr/news/event/1',
    image_url: 'https://www.ff14.co.kr/img/1.png',
    ...over,
  });

  // D-T1: initDB 2회 호출 에러 없음
  try {
    resetDB();
    initDB(TEST_DB);
    const info = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
      .get();
    check(!!info && info.name === 'events', 'D-T1');
  } catch (e) {
    check(false, 'D-T1', e.message);
  }

  // D-T2: upsertEvent insert → getEvent 전 필드 왕복
  try {
    resetDB();
    const ev = sample({
      id: 'e2',
      title: '신생제',
      description: '미소를 담은 여정의 기억',
      start_date: '2026-03-31',
      end_date: '2026-04-13',
      url: 'https://www.ff14.co.kr/news/event/100',
      image_url: 'https://www.ff14.co.kr/img/100.png',
    });
    upsertEvent(ev);
    const got = getEvent('e2');
    const ok =
      got &&
      got.id === ev.id &&
      got.title === ev.title &&
      got.description === ev.description &&
      got.start_date === ev.start_date &&
      got.end_date === ev.end_date &&
      got.url === ev.url &&
      got.image_url === ev.image_url;
    check(ok, 'D-T2', ok ? '' : JSON.stringify(got));
  } catch (e) {
    check(false, 'D-T2', e.message);
  }

  // D-T3: upsert preserves category
  try {
    resetDB();
    upsertEvent(sample({ id: 'e3', title: 'T1', end_date: '2026-06-30' }));
    db.prepare("UPDATE events SET category = 'seasonal' WHERE id = ?").run('e3');
    upsertEvent(sample({ id: 'e3', title: 'T2', end_date: '2026-07-31' }));
    const got = getEvent('e3');
    const ok = got.category === 'seasonal' && got.title === 'T2' && got.end_date === '2026-07-31';
    check(ok, 'D-T3', ok ? '' : JSON.stringify(got));
  } catch (e) {
    check(false, 'D-T3', e.message);
  }

  // D-T4: upsert preserves notified_1day
  try {
    resetDB();
    upsertEvent(sample({ id: 'e4' }));
    db.prepare('UPDATE events SET notified_1day = 1 WHERE id = ?').run('e4');
    upsertEvent(sample({ id: 'e4', title: '갱신됨' }));
    const got = getEvent('e4');
    check(got.notified_1day === 1 && got.title === '갱신됨', 'D-T4', `notified_1day=${got.notified_1day}`);
  } catch (e) {
    check(false, 'D-T4', e.message);
  }

  // D-T5: getActiveEvents returns only currently running events (KST)
  try {
    resetDB();
    upsertEvent(sample({ id: 'past', start_date: '2020-01-01', end_date: '2020-12-31' }));
    upsertEvent(sample({ id: 'curr', start_date: '2000-01-01', end_date: '2099-12-31' }));
    upsertEvent(sample({ id: 'fut', start_date: '2099-01-01', end_date: '2099-12-31' }));
    const active = getActiveEvents();
    const ok = active.length === 1 && active[0].id === 'curr';
    check(ok, 'D-T5', ok ? '' : JSON.stringify(active.map((e) => e.id)));
  } catch (e) {
    check(false, 'D-T5', e.message);
  }

  // D-T6: getEventsByCategory filter + end_date ASC
  try {
    resetDB();
    upsertEvent(sample({ id: 's1', end_date: '2099-06-30' }));
    upsertEvent(sample({ id: 's2', end_date: '2099-03-31' }));
    upsertEvent(sample({ id: 'l1', end_date: '2099-05-31' }));
    upsertEvent(sample({ id: 'p1', end_date: '2099-04-30' }));
    db.prepare("UPDATE events SET category = 'seasonal' WHERE id IN ('s1','s2')").run();
    db.prepare("UPDATE events SET category = 'limited' WHERE id = 's2b' OR id = 'l1'").run();
    db.prepare("UPDATE events SET category = 'permanent' WHERE id = 'p1'").run();
    const seasonal = getEventsByCategory('seasonal');
    const ok =
      seasonal.length === 2 && seasonal[0].id === 's2' && seasonal[1].id === 's1';
    check(ok, 'D-T6', ok ? '' : JSON.stringify(seasonal.map((e) => e.id)));
  } catch (e) {
    check(false, 'D-T6', e.message);
  }

  // D-T7: getUnclassifiedEvents returns only category IS NULL
  try {
    resetDB();
    upsertEvent(sample({ id: 'u1' }));
    upsertEvent(sample({ id: 'u2' }));
    upsertEvent(sample({ id: 'u3' }));
    db.prepare("UPDATE events SET category = 'seasonal' WHERE id = 'u1'").run();
    const un = getUnclassifiedEvents();
    const ids = un.map((e) => e.id).sort();
    const ok = ids.length === 2 && ids[0] === 'u2' && ids[1] === 'u3';
    check(ok, 'D-T7', ok ? '' : JSON.stringify(ids));
  } catch (e) {
    check(false, 'D-T7', e.message);
  }

  // D-T8a/b: getEventsEndingToday / Tomorrow — 단순 end_date 매칭 (ledger 와 무관)
  try {
    resetDB();
    const today = todayKST();
    const tomorrow = tomorrowKST();
    const yesterday = addDaysKST(today, -1);
    const dayAfter = addDaysKST(today, 2);
    upsertEvent(sample({ id: 'today-a', start_date: yesterday, end_date: today }));
    upsertEvent(sample({ id: 'today-b', start_date: yesterday, end_date: today }));
    upsertEvent(sample({ id: 'tmr-a', start_date: today, end_date: tomorrow }));
    upsertEvent(sample({ id: 'tmr-b', start_date: today, end_date: tomorrow }));
    upsertEvent(sample({ id: 'after', start_date: today, end_date: dayAfter }));
    upsertEvent(sample({ id: 'yday', start_date: yesterday, end_date: yesterday }));

    const todayIds = new Set(getEventsEndingToday().map((e) => e.id));
    const okToday = todayIds.size === 2 && todayIds.has('today-a') && todayIds.has('today-b');
    check(okToday, 'D-T8a getEventsEndingToday', okToday ? '' : JSON.stringify([...todayIds]));

    const tmrIds = new Set(getEventsEndingTomorrow().map((e) => e.id));
    const okTmr = tmrIds.size === 2 && tmrIds.has('tmr-a') && tmrIds.has('tmr-b');
    check(okTmr, 'D-T8b getEventsEndingTomorrow', okTmr ? '' : JSON.stringify([...tmrIds]));
  } catch (e) {
    check(false, 'D-T8', e.message);
  }

  // D-T9: hasNotified / markNotified — guild-scoped ledger, 멱등
  try {
    resetDB();
    upsertEvent(sample({ id: 'm1' }));
    check(!hasNotified('g1', 'm1', 'd1'), 'D-T9a hasNotified initial false');
    markNotified('g1', 'm1', 'd1');
    check(hasNotified('g1', 'm1', 'd1'), 'D-T9b after mark true');
    // 다른 guild / 다른 kind 는 false 그대로
    check(!hasNotified('g2', 'm1', 'd1'), 'D-T9c other guild still false');
    check(!hasNotified('g1', 'm1', 'd0'), 'D-T9d other kind still false');
    // 중복 호출 멱등 (PK 충돌)
    markNotified('g1', 'm1', 'd1');
    const n = db
      .prepare(
        "SELECT COUNT(*) AS n FROM notification_log WHERE guild_id='g1' AND event_id='m1' AND kind='d1'",
      )
      .get();
    check(n.n === 1, 'D-T9e markNotified idempotent', `n=${n.n}`);
  } catch (e) {
    check(false, 'D-T9', e.message);
  }

  // D-T10: image_url null/string roundtrip
  try {
    resetDB();
    upsertEvent(sample({ id: 'img-null', image_url: null }));
    upsertEvent(
      sample({ id: 'img-str', image_url: 'https://www.ff14.co.kr/img/abc.png' })
    );
    const a = getEvent('img-null');
    const b = getEvent('img-str');
    const ok =
      a.image_url === null && b.image_url === 'https://www.ff14.co.kr/img/abc.png';
    check(ok, 'D-T10', ok ? '' : `a=${a.image_url}, b=${b.image_url}`);
  } catch (e) {
    check(false, 'D-T10', e.message);
  }

  // D-T11: initDB 2회 호출 후 guild_config 테이블 존재
  try {
    resetDB();
    initDB(TEST_DB);
    const info = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'")
      .get();
    check(!!info && info.name === 'guild_config', 'D-T11');
  } catch (e) {
    check(false, 'D-T11', e.message);
  }

  // D-T12: upsertGuildConfig 2회 → added_at 보존, updated_at 갱신, notify_channel_id 갱신
  try {
    resetDB();
    upsertGuildConfig({ guild_id: 'g1', notify_channel_id: 'c1' });
    const past = '2020-01-01 00:00:00';
    db.prepare(
      "UPDATE guild_config SET added_at = ?, updated_at = ? WHERE guild_id = 'g1'"
    ).run(past, past);
    upsertGuildConfig({ guild_id: 'g1', notify_channel_id: 'c2' });
    const got = getGuildConfig('g1');
    const all = db.prepare("SELECT COUNT(*) AS n FROM guild_config WHERE guild_id = 'g1'").get();
    const ok =
      all.n === 1 &&
      got.added_at === past &&
      got.updated_at !== past &&
      got.notify_channel_id === 'c2';
    check(ok, 'D-T12', ok ? '' : JSON.stringify(got));
  } catch (e) {
    check(false, 'D-T12', e.message);
  }

  // D-T13: setNotifyChannel → notify_channel_id·updated_at만 변화, added_at 그대로
  try {
    resetDB();
    upsertGuildConfig({ guild_id: 'g1', notify_channel_id: 'c1' });
    const past = '2020-01-01 00:00:00';
    db.prepare(
      "UPDATE guild_config SET added_at = ?, updated_at = ? WHERE guild_id = 'g1'"
    ).run(past, past);
    setNotifyChannel('g1', 'c2');
    const got = getGuildConfig('g1');
    const ok =
      got.added_at === past &&
      got.updated_at !== past &&
      got.notify_channel_id === 'c2';
    check(ok, 'D-T13', ok ? '' : JSON.stringify(got));
  } catch (e) {
    check(false, 'D-T13', e.message);
  }

  // D-T13b: setNotifyChannel creates guild_config row if missing
  try {
    resetDB();
    setNotifyChannel('g-missing', 'c-created');
    const got = getGuildConfig('g-missing');
    const ok =
      got &&
      got.guild_id === 'g-missing' &&
      got.notify_channel_id === 'c-created' &&
      got.added_at &&
      got.updated_at;
    check(ok, 'D-T13b', ok ? '' : JSON.stringify(got));
  } catch (e) {
    check(false, 'D-T13b', e.message);
  }

  // D-T14: guild A(notify=null), B(notify=value) → getAllGuildConfigs에는 B만
  try {
    resetDB();
    upsertGuildConfig({ guild_id: 'gA', notify_channel_id: null });
    upsertGuildConfig({ guild_id: 'gB', notify_channel_id: 'cB' });
    const all = getAllGuildConfigs();
    const ok = all.length === 1 && all[0].guild_id === 'gB' && all[0].notify_channel_id === 'cB';
    check(ok, 'D-T14', ok ? '' : JSON.stringify(all.map((r) => r.guild_id)));
  } catch (e) {
    check(false, 'D-T14', e.message);
  }

  // D-T15: removeGuildConfig(B) → getGuildConfig(B) is undefined
  try {
    resetDB();
    upsertGuildConfig({ guild_id: 'gB', notify_channel_id: 'cB' });
    removeGuildConfig('gB');
    const got = getGuildConfig('gB');
    check(got === undefined, 'D-T15', `got=${JSON.stringify(got)}`);
  } catch (e) {
    check(false, 'D-T15', e.message);
  }

  // D-T16: getLastEventUpdate — empty DB → null
  try {
    resetDB();
    const got = getLastEventUpdate();
    check(got === null, 'D-T16', `got=${JSON.stringify(got)}`);
  } catch (e) {
    check(false, 'D-T16', e.message);
  }

  // D-T17: getLastEventUpdate — returns MAX(updated_at)
  try {
    resetDB();
    upsertEvent(sample({ id: 'old' }));
    upsertEvent(sample({ id: 'mid' }));
    upsertEvent(sample({ id: 'new' }));
    db.prepare("UPDATE events SET updated_at = '2024-01-01 00:00:00' WHERE id = 'old'").run();
    db.prepare("UPDATE events SET updated_at = '2025-06-15 12:00:00' WHERE id = 'mid'").run();
    db.prepare("UPDATE events SET updated_at = '2026-01-01 09:30:00' WHERE id = 'new'").run();
    const got = getLastEventUpdate();
    check(got === '2026-01-01 09:30:00', 'D-T17', `got=${got}`);
  } catch (e) {
    check(false, 'D-T17', e.message);
  }

  // D-T19: getCurrentEvents — active AND days<365 AND not permanent (NULL OK)
  try {
    resetDB();
    const today = todayKST();
    const tomorrow = addDaysKST(today, 1);
    const longTerm = addDaysKST(today, 1500);
    upsertEvent(sample({ id: 'c-soon', start_date: today, end_date: tomorrow }));
    upsertEvent(sample({ id: 'c-soon-null', start_date: today, end_date: tomorrow }));
    upsertEvent(sample({ id: 'c-soon-perm', start_date: today, end_date: tomorrow }));
    upsertEvent(sample({ id: 'c-long-null', start_date: today, end_date: longTerm }));
    upsertEvent(sample({ id: 'c-long-perm', start_date: today, end_date: longTerm }));
    db.prepare("UPDATE events SET category = 'seasonal' WHERE id = 'c-soon'").run();
    db.prepare("UPDATE events SET category = 'permanent' WHERE id IN ('c-soon-perm', 'c-long-perm')").run();
    const current = getCurrentEvents().map((e) => e.id).sort();
    const ok = current.length === 2 && current[0] === 'c-soon' && current[1] === 'c-soon-null';
    check(ok, 'D-T19', ok ? '' : JSON.stringify(current));
  } catch (e) {
    check(false, 'D-T19', e.message);
  }

  // D-T20: getLongTermEvents — permanent category OR days>=365
  try {
    resetDB();
    const today = todayKST();
    const tomorrow = addDaysKST(today, 1);
    const longTerm = addDaysKST(today, 1500);
    upsertEvent(sample({ id: 'l-soon', start_date: today, end_date: tomorrow }));
    upsertEvent(sample({ id: 'l-soon-perm', start_date: today, end_date: tomorrow }));
    upsertEvent(sample({ id: 'l-long-null', start_date: today, end_date: longTerm }));
    upsertEvent(sample({ id: 'l-long-limited', start_date: today, end_date: longTerm }));
    db.prepare("UPDATE events SET category = 'permanent' WHERE id = 'l-soon-perm'").run();
    db.prepare("UPDATE events SET category = 'limited' WHERE id = 'l-long-limited'").run();
    const long = getLongTermEvents().map((e) => e.id).sort();
    const ok =
      long.length === 3 &&
      long[0] === 'l-long-limited' &&
      long[1] === 'l-long-null' &&
      long[2] === 'l-soon-perm';
    check(ok, 'D-T20', ok ? '' : JSON.stringify(long));
  } catch (e) {
    check(false, 'D-T20', e.message);
  }

  // D-T21: migrate adds is_welcome + heuristic backfill on existing data
  try {
    if (db) {
      db.close();
      db = undefined;
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = TEST_DB + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    // Simulate pre-migration DB (no is_welcome column)
    const tmp = new Database(TEST_DB);
    tmp.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        url TEXT,
        image_url TEXT,
        category TEXT,
        notified_1day INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    tmp.prepare("INSERT INTO events (id, title, start_date, end_date) VALUES ('w1', '강화된 복귀 혜택', '2026-04-01', '2026-04-30')").run();
    tmp.prepare("INSERT INTO events (id, title, start_date, end_date) VALUES ('w2', '풍성한 신규 혜택', '2026-04-01', '2026-04-30')").run();
    tmp.prepare("INSERT INTO events (id, title, start_date, end_date) VALUES ('w3', '신생제', '2026-04-01', '2026-04-30')").run();
    tmp.close();

    initDB(TEST_DB);
    const rows = db.prepare("SELECT id, is_welcome FROM events ORDER BY id").all();
    const ok =
      rows.length === 3 &&
      rows[0].is_welcome === 1 && // 복귀
      rows[1].is_welcome === 1 && // 신규
      rows[2].is_welcome === 0;   // 신생제
    check(ok, 'D-T21', ok ? '' : JSON.stringify(rows));
  } catch (e) {
    check(false, 'D-T21', e.message);
  }

  // D-T22: updateEventClassification sets both category and is_welcome
  try {
    resetDB();
    upsertEvent(sample({ id: 'cls1' }));
    updateEventClassification('cls1', 'limited', true);
    const a = getEvent('cls1');
    updateEventClassification('cls1', 'permanent', false);
    const b = getEvent('cls1');
    const ok =
      a.category === 'limited' && a.is_welcome === 1 &&
      b.category === 'permanent' && b.is_welcome === 0;
    check(ok, 'D-T22', ok ? '' : JSON.stringify({ a, b }));
  } catch (e) {
    check(false, 'D-T22', e.message);
  }

  // D-T23: migrate backfill — 글로벌 notified_1day=1 + 알림 등록 길드 → ledger
  try {
    if (db) {
      db.close();
      db = undefined;
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = TEST_DB + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    // Pre-migration DB: events 에 notified_1day=1 두 건, guild_config 에 알림 등록 1개·미등록 1개
    const tmp = new Database(TEST_DB);
    tmp.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        url TEXT,
        image_url TEXT,
        category TEXT,
        notified_1day INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE guild_config (
        guild_id TEXT PRIMARY KEY,
        notify_channel_id TEXT,
        added_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    tmp.prepare("INSERT INTO events (id, title, start_date, end_date, notified_1day) VALUES ('e-sent', 'sent', '2026-04-01', '2026-04-30', 1)").run();
    tmp.prepare("INSERT INTO events (id, title, start_date, end_date, notified_1day) VALUES ('e-fresh', 'fresh', '2026-04-01', '2026-04-30', 0)").run();
    tmp.prepare("INSERT INTO guild_config (guild_id, notify_channel_id) VALUES ('g-notify', 'c1')").run();
    tmp.prepare("INSERT INTO guild_config (guild_id, notify_channel_id) VALUES ('g-silent', NULL)").run();
    tmp.close();

    initDB(TEST_DB);
    const backfilled = hasNotified('g-notify', 'e-sent', 'd1');
    const freshSkipped = !hasNotified('g-notify', 'e-fresh', 'd1');
    const silentSkipped = !hasNotified('g-silent', 'e-sent', 'd1');
    // 레거시 'd1' 은 단일 'ending' kind 로도 통합되어야 한다 (이후 dedup 은 'ending' 기준)
    const endingBackfilled = hasNotified('g-notify', 'e-sent', 'ending');
    const endingFreshSkipped = !hasNotified('g-notify', 'e-fresh', 'ending');
    // 재호출 멱등: 다시 migrate 호출해도 행 수 변화 없어야 함 ('d1' + 'ending' = 2)
    const before = db.prepare('SELECT COUNT(*) AS n FROM notification_log').get().n;
    migrate();
    const after = db.prepare('SELECT COUNT(*) AS n FROM notification_log').get().n;
    const ok = backfilled && freshSkipped && silentSkipped && endingBackfilled &&
      endingFreshSkipped && before === after && before === 2;
    check(ok, 'D-T23 migrate backfill', ok ? '' : `backfilled=${backfilled} fresh=${freshSkipped} silent=${silentSkipped} ending=${endingBackfilled} endingFresh=${endingFreshSkipped} before=${before} after=${after}`);
  } catch (e) {
    check(false, 'D-T23', e.message);
  }

  // D-T24: pruneStaleGuildConfigs — active 에 없는 guild_config 만 삭제, notification_log 보존
  try {
    resetDB();
    upsertGuildConfig({ guild_id: 'g-active', notify_channel_id: 'c1' });
    upsertGuildConfig({ guild_id: 'g-stale', notify_channel_id: 'c2' });
    upsertEvent(sample({ id: 'e1' }));
    markNotified('g-active', 'e1', 'd1');
    markNotified('g-stale', 'e1', 'd1');

    const removed = pruneStaleGuildConfigs(new Set(['g-active']));
    const okRemovedList = removed.length === 1 && removed[0] === 'g-stale';
    const activeKept = !!getGuildConfig('g-active');
    const staleGone = getGuildConfig('g-stale') === undefined;
    // notification_log 는 보존 — 두 행 모두 그대로
    const logRows = db.prepare('SELECT COUNT(*) AS n FROM notification_log').get().n;
    const ok = okRemovedList && activeKept && staleGone && logRows === 2;
    check(ok, 'D-T24 pruneStaleGuildConfigs', ok ? '' : `removed=${JSON.stringify(removed)} active=${activeKept} stale=${staleGone} log=${logRows}`);
  } catch (e) {
    check(false, 'D-T24', e.message);
  }

  // D-T18: getPastEvents — end_date < today, ordered by end_date DESC
  try {
    resetDB();
    const today = todayKST();
    const yesterday = addDaysKST(today, -1);
    const lastWeek = addDaysKST(today, -7);
    const lastMonth = addDaysKST(today, -30);
    const tomorrow = addDaysKST(today, 1);
    upsertEvent(sample({ id: 'past-yday', start_date: lastMonth, end_date: yesterday }));
    upsertEvent(sample({ id: 'past-week', start_date: lastMonth, end_date: lastWeek }));
    upsertEvent(sample({ id: 'past-month', start_date: lastMonth, end_date: lastMonth }));
    upsertEvent(sample({ id: 'today', start_date: lastWeek, end_date: today }));
    upsertEvent(sample({ id: 'future', start_date: today, end_date: tomorrow }));
    const past = getPastEvents();
    const ids = past.map((e) => e.id);
    const ok =
      ids.length === 3 &&
      ids[0] === 'past-yday' &&
      ids[1] === 'past-week' &&
      ids[2] === 'past-month';
    check(ok, 'D-T18', ok ? '' : JSON.stringify(ids));
  } catch (e) {
    check(false, 'D-T18', e.message);
  }

  console.log(`\n총 ${results.pass + results.fail}건 중 ${results.pass} PASS / ${results.fail} FAIL`);

  if (db) db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  process.exit(results.fail === 0 ? 0 : 1);
}
