import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import {
  initDB,
  ensureGuildConfig,
  removeGuildConfig,
} from './storage.js';
import {
  handleEventCommand,
  handleSetNotifyChannel,
} from './commands.js';
import { startScheduler } from './scheduler.js';

initDB();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, readyClient => {
  console.log(`✅ 로그인: ${readyClient.user.tag}`);
  for (const [id] of readyClient.guilds.cache) {
    ensureGuildConfig(id);
  }
  console.log(`[guild] 참여 길드 ${readyClient.guilds.cache.size}개 동기화 완료`);
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
    }
  } catch (err) {
    console.error('[interaction] 처리 실패:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
