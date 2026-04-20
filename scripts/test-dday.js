import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { formatDday, buildAlertContainer } from '../src/ui.js';
import { initDB, getAllGuildConfigs } from '../src/storage.js';

const ONE_DAY_MS = 86_400_000;
const KST_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
const toKstDate = (date) => KST_FMT.format(date);
const mkEnd = (days) => toKstDate(new Date(Date.now() + days * ONE_DAY_MS));

const cases = [
  { label: '어제 종료 (days=-1)', days: -1 },
  { label: '오늘 종료 (days=0)', days: 0 },
  { label: 'D-1', days: 1 },
  { label: 'D-7', days: 7 },
  { label: 'D-365 경계', days: 365 },
  { label: '장기 이벤트 (days=400)', days: 400 },
];

function buildFakeEvent({ label, days }) {
  return {
    id: `test-dday-${days}`,
    title: `[TEST] ${label}`,
    description: 'formatDday 경계값 테스트',
    start_date: toKstDate(new Date(Date.now() - 7 * ONE_DAY_MS)),
    end_date: mkEnd(days),
    url: 'https://www.ff14.co.kr/news/event',
    image_url: 'https://www.ff14.co.kr/img/common/logo.png',
    category: 'seasonal',
  };
}

console.log(`now (KST date): ${toKstDate(new Date())}`);
console.log('---');
const events = cases.map(buildFakeEvent);
for (const ev of events) {
  const { badge, endTag } = formatDday(ev.end_date);
  console.log(`[${ev.title}]`);
  console.log(`  end_date: ${ev.end_date}`);
  console.log(`  badge:    ${badge}`);
  console.log(`  endTag:   ${endTag ?? '(null)'}`);
  console.log();
}

const testGuildId = process.env.TEST_GUILD_ID;
if (!testGuildId) {
  console.error(
    '⛔ TEST_GUILD_ID 환경변수가 필요합니다. 실수로 전체 길드에 스팸 전송하는 것을 막기 위함입니다.',
  );
  console.error('   사용법: TEST_GUILD_ID=<guild_id> node scripts/test-dday.js');
  process.exit(1);
}

initDB();
const allConfigs = getAllGuildConfigs();
const guildConfigs = allConfigs.filter((c) => c.guild_id === testGuildId);
if (guildConfigs.length === 0) {
  console.error(
    `⛔ guild_id=${testGuildId} 에 해당하는 알림 채널 설정이 없음. /이벤트-알림채널 먼저 실행하거나 TEST_GUILD_ID 값을 확인하세요.`,
  );
  process.exit(1);
}

console.log('전송 대상:');
for (const { guild_id, notify_channel_id } of guildConfigs) {
  console.log(`  guild=${guild_id} channel=${notify_channel_id}`);
}
console.log(`총 ${events.length}건 × ${guildConfigs.length}길드 전송 시작.`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ 로그인: ${c.user.tag}`);
  for (const { guild_id, notify_channel_id } of guildConfigs) {
    try {
      const channel = await c.channels.fetch(notify_channel_id);
      for (const event of events) {
        const container = buildAlertContainer({ event });
        await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        console.log(`[전송] ${event.title} → guild=${guild_id} channel=${notify_channel_id}`);
      }
    } catch (err) {
      console.warn(`[실패] guild=${guild_id}:`, err.message);
    }
  }
  await c.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
