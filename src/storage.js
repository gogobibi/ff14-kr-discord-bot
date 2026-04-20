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
    notified_1day INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    notify_channel_id TEXT,
    added_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`;

let db;

export function initDB(dbPath = DEFAULT_DB_PATH) {
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
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

export function getEventsEndingTomorrow() {
  ensureDB();
  const tomorrow = tomorrowKST();
  return db
    .prepare('SELECT * FROM events WHERE end_date = ? AND notified_1day = 0')
    .all(tomorrow);
}

export function markNotified(id) {
  ensureDB();
  return db
    .prepare('UPDATE events SET notified_1day = 1 WHERE id = ?')
    .run(id);
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
      `UPDATE guild_config SET notify_channel_id = ?, updated_at = datetime('now') WHERE guild_id = ?`
    )
    .run(channel_id, guild_id);
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

export function updateEventCategory(id, category) {
  ensureDB();
  return db
    .prepare("UPDATE events SET category = ?, updated_at = datetime('now') WHERE id = ?")
    .run(category, id);
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

  // D-T8: getEventsEndingTomorrow — only end=tomorrow AND notified_1day=0
  try {
    resetDB();
    const today = todayKST();
    const tomorrow = tomorrowKST();
    const dayAfter = addDaysKST(today, 2);
    upsertEvent(sample({ id: 'tmr-open', start_date: today, end_date: tomorrow }));
    upsertEvent(sample({ id: 'tmr-notified', start_date: today, end_date: tomorrow }));
    db.prepare("UPDATE events SET notified_1day = 1 WHERE id = 'tmr-notified'").run();
    upsertEvent(sample({ id: 'after', start_date: today, end_date: dayAfter }));
    const ending = getEventsEndingTomorrow();
    const ok = ending.length === 1 && ending[0].id === 'tmr-open';
    check(ok, 'D-T8', ok ? '' : JSON.stringify(ending.map((e) => e.id)));
  } catch (e) {
    check(false, 'D-T8', e.message);
  }

  // D-T9: markNotified sets notified_1day = 1
  try {
    resetDB();
    upsertEvent(sample({ id: 'm1' }));
    markNotified('m1');
    const got = getEvent('m1');
    check(got.notified_1day === 1, 'D-T9', `notified_1day=${got.notified_1day}`);
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

  console.log(`\n총 ${results.pass + results.fail}건 중 ${results.pass} PASS / ${results.fail} FAIL`);

  if (db) db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  process.exit(results.fail === 0 ? 0 : 1);
}
