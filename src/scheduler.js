import cron from 'node-cron';
import { MessageFlags } from 'discord.js';
import { scrapeEvents } from './scraper.js';
import { classifyEventsBatch } from './classifier.js';
import {
  upsertEvent,
  getUnclassifiedEvents,
  getEventsEndingSoon,
  getAllGuildConfigs,
  markNotified,
  updateEventClassification,
} from './storage.js';
import { buildAlertContainer } from './ui.js';

const TZ = { timezone: 'Asia/Seoul' };

let isScraping = false;

async function runScrape() {
  if (isScraping) return { skipped: true };
  isScraping = true;
  try {
    const events = await scrapeEvents();
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

async function notifyJob(client) {
  try {
    const endingEvents = getEventsEndingSoon();
    if (endingEvents.length === 0) return;
    const guildConfigs = getAllGuildConfigs();
    for (const { guild_id, notify_channel_id } of guildConfigs) {
      try {
        const channel = await client.channels.fetch(notify_channel_id);
        for (const event of endingEvents) {
          const container = buildAlertContainer({ event });
          await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
      } catch (err) {
        console.warn(`[알림] 길드 ${guild_id} 실패:`, err.message);
      }
    }
    for (const event of endingEvents) markNotified(event.id);
  } catch (err) {
    console.error('[알림] 실패:', err);
  }
}

export function startScheduler(client) {
  cron.schedule('45 17 * * *', scrapeJob, TZ);
  cron.schedule('0 20 * * *', scrapeJob, TZ);
  cron.schedule('0 9 * * *', () => notifyJob(client), TZ);
  console.log('[scheduler] cron 시작 (KST): 17:45·20:00 스크래핑 + 09:00 알림');
}
