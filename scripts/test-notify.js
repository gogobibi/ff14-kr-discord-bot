import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import {
  initDB,
  getAllEvents,
  getEvent,
  getAllGuildConfigs,
} from '../src/storage.js';
import { buildAlertContainer } from '../src/ui.js';

initDB();

const argEventId = process.argv[2];

let event;
if (argEventId) {
  event = getEvent(argEventId);
  if (!event) {
    console.error(`이벤트 없음: id=${argEventId}`);
    process.exit(1);
  }
} else {
  const all = getAllEvents()
    .filter((e) => e.end_date)
    .sort((a, b) => new Date(a.end_date) - new Date(b.end_date));
  if (all.length === 0) {
    console.error('DB에 이벤트 없음. 먼저 스크래핑 필요.');
    process.exit(1);
  }
  event = all[0];
  console.log(`이벤트 자동 선택: ${event.id} · ${event.title} (종료 ${event.end_date})`);
}

const guildConfigs = getAllGuildConfigs();
if (guildConfigs.length === 0) {
  console.error('알림 채널이 설정된 길드가 없음. /이벤트-알림채널 먼저 실행.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ 로그인: ${c.user.tag}`);
  for (const { guild_id, notify_channel_id } of guildConfigs) {
    try {
      const channel = await c.channels.fetch(notify_channel_id);
      const container = buildAlertContainer({ event });
      await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
      console.log(`[전송] guild=${guild_id} channel=${notify_channel_id}`);
    } catch (err) {
      console.warn(`[실패] guild=${guild_id}:`, err.message);
    }
  }
  await c.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
