import 'dotenv/config';
import {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN / DISCORD_CLIENT_ID 환경변수가 필요합니다.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('이벤트')
    .setDescription('FF14 진행 중 이벤트 조회')
    .addStringOption((o) =>
      o
        .setName('필터')
        .setDescription('카테고리')
        .addChoices(
          { name: '시즈널', value: 'seasonal' },
          { name: '한정', value: 'limited' },
          { name: '상시', value: 'permanent' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('이벤트-알림채널')
    .setDescription('종료 1일 전 알림을 보낼 채널 설정')
    .addChannelOption((o) =>
      o
        .setName('채널')
        .setDescription('알림 채널')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function main() {
  console.log(`[deploy] Global 등록 중 (${commands.length}개)…`);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('[deploy] Global 등록 완료 (전파까지 최대 1시간)');

  // DEV_GUILD_ID가 설정되어 있으면 Guild 스코프로도 병행 등록한다.
  // Guild 커맨드는 즉시 반영되어 개발 중 빠른 테스트에 유리하다.
  if (DEV_GUILD_ID) {
    console.log(`[deploy] Guild(${DEV_GUILD_ID}) 병행 등록 중…`);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), {
      body: commands,
    });
    console.log('[deploy] Guild 등록 완료 (즉시 반영)');
  }
}

main().catch((err) => {
  console.error('[deploy] 실패:', err);
  process.exit(1);
});
