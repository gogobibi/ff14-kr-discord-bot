import cron from 'node-cron';
import { MessageFlags } from 'discord.js';
import { scrapeEvents } from './scraper.js';
import { classifyEventsBatch } from './classifier.js';
import {
  upsertEvent,
  getUnclassifiedEvents,
  getEventsEndingToday,
  getEventsEndingTomorrow,
  getAllGuildConfigs,
  hasNotified,
  markNotified,
  updateEventClassification,
  getLastEventUpdate,
} from './storage.js';
import { buildAlertContainer } from './ui.js';

const TZ = { timezone: 'Asia/Seoul' };
const INITIAL_STALE_HOURS = 6;

let isScraping = false;

async function runScrape(options = {}) {
  if (isScraping) return { skipped: true };
  isScraping = true;
  try {
    const events = await scrapeEvents(options);
    let upserts = 0;
    for (const e of events) {
      upsertEvent(e);
      upserts++;
    }
    const unclassified = getUnclassifiedEvents();
    let classified = 0;
    if (unclassified.length > 0) {
      const results = await classifyEventsBatch(
        unclassified.map((e) => ({
          title: e.title,
          description: e.description,
          start_date: e.start_date,
          end_date: e.end_date,
        })),
      );
      for (let i = 0; i < unclassified.length; i++) {
        const { category, is_welcome } = results[i];
        if (category) {
          updateEventClassification(unclassified[i].id, category, !!is_welcome);
          classified++;
        }
      }
    }
    return { total: events.length, upserts, classified };
  } finally {
    isScraping = false;
  }
}

async function scrapeJob() {
  try {
    const r = await runScrape();
    if (r.skipped) {
      console.log('[스크래핑] 이미 실행 중이라 skip');
      return;
    }
    console.log(`[스크래핑] 총 ${r.total}, upsert ${r.upserts}, 분류 ${r.classified}`);
  } catch (err) {
    console.error('[스크래핑] 실패:', err);
  }
}

export async function runScrapeNow() {
  return runScrape();
}

async function notifyJob(client, { fetchEvents, kind, label }) {
  try {
    const endingEvents = fetchEvents();
    if (endingEvents.length === 0) return;
    const guildConfigs = getAllGuildConfigs();
    let sentCount = 0;
    for (const { guild_id, notify_channel_id } of guildConfigs) {
      try {
        const channel = await client.channels.fetch(notify_channel_id);
        for (const event of endingEvents) {
          if (event.is_welcome) continue;
          if (hasNotified(guild_id, event.id, kind)) continue;
          const container = buildAlertContainer({ event });
          await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
          markNotified(guild_id, event.id, kind);
          sentCount++;
        }
      } catch (err) {
        console.warn(`[알림:${label}] 길드 ${guild_id} 실패:`, err.message);
      }
    }
    if (sentCount > 0) {
      console.log(`[알림:${label}] ${sentCount}건 발송`);
    }
  } catch (err) {
    console.error(`[알림:${label}] 실패:`, err);
  }
}

async function initialScrapeIfNeeded() {
  const last = getLastEventUpdate();
  if (last === null) {
    console.log('[scheduler] DB 비어있음 — 초기 스크래핑 (진행중 + 이전)');
    const r = await runScrape({ includeEnded: true });
    if (!r.skipped) {
      console.log(`[스크래핑:초기] 총 ${r.total}, upsert ${r.upserts}, 분류 ${r.classified}`);
    }
    return;
  }
  const lastMs = new Date(last.replace(' ', 'T') + 'Z').getTime();
  const ageHours = (Date.now() - lastMs) / 1000 / 3600;
  if (ageHours >= INITIAL_STALE_HOURS) {
    console.log(`[scheduler] 마지막 업데이트 ${ageHours.toFixed(1)}h 전 — 부팅 스크래핑`);
    const r = await runScrape();
    if (!r.skipped) {
      console.log(`[스크래핑:부팅] 총 ${r.total}, upsert ${r.upserts}, 분류 ${r.classified}`);
    }
  }
}

export function startScheduler(client) {
  cron.schedule('45 17 * * *', scrapeJob, TZ);
  cron.schedule('0 20 * * *', scrapeJob, TZ);
  cron.schedule(
    '0 19 * * *',
    () => notifyJob(client, {
      fetchEvents: getEventsEndingTomorrow,
      kind: 'd1',
      label: 'D-1',
    }),
    TZ,
  );
  cron.schedule(
    '0 9 * * *',
    () => notifyJob(client, {
      fetchEvents: getEventsEndingToday,
      kind: 'd0',
      label: 'D-0',
    }),
    TZ,
  );
  console.log('[scheduler] cron 시작 (KST): 17:45·20:00 스크래핑 + 19:00 D-1 알림 + 09:00 D-0 알림');
  initialScrapeIfNeeded().catch((err) =>
    console.error('[scheduler] 초기 스크래핑 실패:', err),
  );
}
