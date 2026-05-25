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

const testGuildId = process.env.TEST_GUILD_ID;
if (!testGuildId) {
  console.error(
    '⛔ TEST_GUILD_ID 환경변수가 필요합니다. 실수로 전체 길드에 스팸 전송하는 것을 막기 위함입니다.',
  );
  console.error('   사용법: TEST_GUILD_ID=<guild_id> node scripts/test-notify.js [eventId]');
  process.exit(1);
}

const allConfigs = getAllGuildConfigs();
const guildConfigs = allConfigs.filter((c) => c.guild_id === testGuildId);
if (guildConfigs.length === 0) {
  console.error(
    `⛔ guild_id=${testGuildId} 에 해당하는 알림 채널 설정이 없음. /이벤트-알림채널 먼저 실행하거나 TEST_GUILD_ID 값을 확인하세요.`,
  );
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
