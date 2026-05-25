import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import {
  initDB,
  ensureGuildConfig,
  removeGuildConfig,
  pruneStaleGuildConfigs,
} from './storage.js';
import {
  handleEventCommand,
  handleSetNotifyChannel,
  handleScrapeNow,
} from './commands.js';
import { startScheduler } from './scheduler.js';

initDB();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, readyClient => {
  console.log(`✅ 로그인: ${readyClient.user.tag}`);
  const activeIds = new Set(readyClient.guilds.cache.keys());
  for (const id of activeIds) {
    ensureGuildConfig(id);
  }
  const pruned = pruneStaleGuildConfigs(activeIds);
  if (pruned.length > 0) {
    console.log(`[guild] stale guild_config ${pruned.length}건 정리: ${pruned.join(', ')}`);
  }
  console.log(`[guild] 참여 길드 ${activeIds.size}개 동기화 완료`);
  startScheduler(readyClient);
});

client.on(Events.GuildCreate, guild => {
  ensureGuildConfig(guild.id);
  console.log(`[guild] joined ${guild.name} (${guild.id})`);
});

client.on(Events.GuildDelete, guild => {
  removeGuildConfig(guild.id);
  console.log(`[guild] left ${guild.name} (${guild.id})`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === '이벤트') return handleEventCommand(interaction);
      if (interaction.commandName === '이벤트-알림채널') return handleSetNotifyChannel(interaction);
      if (interaction.commandName === '이벤트-스크래핑') return handleScrapeNow(interaction);
    }
  } catch (err) {
    console.error('[interaction] 처리 실패:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
