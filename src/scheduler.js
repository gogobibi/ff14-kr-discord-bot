import cron from 'node-cron';
import { MessageFlags } from 'discord.js';
import { scrapeEvents } from './scraper.js';
import { classifyEvent } from './classifier.js';
import {
  upsertEvent,
  getUnclassifiedEvents,
  getEventsEndingTomorrow,
  getAllGuildConfigs,
  markNotified,
  updateEventCategory,
} from './storage.js';
import { buildAlertContainer } from './ui.js';

const TZ = { timezone: 'Asia/Seoul' };

async function scrapeJob() {
  try {
    const events = await scrapeEvents();
    let upserts = 0;
    for (const e of events) {
      upsertEvent(e);
      upserts++;
    }
    const unclassified = getUnclassifiedEvents();
    let classified = 0;
    for (const e of unclassified) {
      const { category } = await classifyEvent({ title: e.title, description: e.description });
      if (category) {
        updateEventCategory(e.id, category);
        classified++;
      }
    }
    console.log(`[스크래핑] 총 ${events.length}, upsert ${upserts}, 분류 ${classified}`);
  } catch (err) {
    console.error('[스크래핑] 실패:', err);
  }
}

async function notifyJob(client) {
  try {
    const endingEvents = getEventsEndingTomorrow();
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
  cron.schedule('0 * * * *', scrapeJob, TZ);
  cron.schedule('0 9 * * *', () => notifyJob(client), TZ);
  console.log('[scheduler] cron 시작 (KST): 매시간 스크래핑 + 09:00 알림');
}
