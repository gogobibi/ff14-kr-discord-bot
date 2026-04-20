import fs from 'node:fs';
import { scrapeEvents } from '../src/scraper.js';
import { initDB, upsertEvent, getAllEvents } from '../src/storage.js';

const CONTRACT_DB = 'data/events.contract.db';

function cleanupDB() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = CONTRACT_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

async function main() {
  cleanupDB();
  const db = initDB(CONTRACT_DB);

  console.log('[C-T1] scrapeEvents() 호출…');
  const events = await scrapeEvents();
  console.log(`[C-T1] 스크랩 결과: ${events.length}건`);
  if (events.length === 0) {
    throw new Error('scrapeEvents()가 0건 반환 — 네트워크/셀렉터 문제 가능');
  }

  const uniqueIds = new Set(events.map((e) => e.id));
  if (uniqueIds.size !== events.length) {
    throw new Error(
      `스크래퍼 결과에 중복 id 존재 (고유 ${uniqueIds.size}, 전체 ${events.length})`
    );
  }

  console.log('[C-T1] upsertEvent 루프 실행…');
  for (const ev of events) {
    upsertEvent(ev);
  }

  const stored = getAllEvents();
  const pass = stored.length === events.length;

  if (pass) {
    console.log(`PASS: C-T1 — scrapeEvents(${events.length}) → getAllEvents(${stored.length}) 일치`);
  } else {
    console.log(
      `FAIL: C-T1 — scraped=${events.length} stored=${stored.length}`
    );
  }

  db.close();
  cleanupDB();

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.log(`FAIL: C-T1 — ${err?.message || err}`);
  try {
    cleanupDB();
  } catch {}
  process.exit(1);
});
