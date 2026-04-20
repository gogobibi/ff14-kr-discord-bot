import { MessageFlags, PermissionsBitField } from 'discord.js';
import {
  getActiveEvents,
  getEventsByCategory,
  setNotifyChannel,
} from './storage.js';
import { buildEventListContainer, buildEmptyContainer } from './ui.js';

function buildContainerForFilter(filter) {
  const lastUpdatedUnix = Math.floor(Date.now() / 1000);
  let events;
  if (filter && filter !== 'all') {
    events = getEventsByCategory(filter);
  } else {
    events = getActiveEvents().filter((e) => e.category !== 'permanent');
  }
  if (events.length === 0) {
    return buildEmptyContainer();
  }
  return buildEventListContainer({
    events,
    filter: filter ?? 'all',
    lastUpdatedUnix,
  });
}

async function respondError(interaction, content) {
  const payload = { content, ephemeral: true };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    console.error('Failed to send error response:', err);
  }
}

export async function handleEventCommand(interaction) {
  try {
    await interaction.deferReply();
    const filterOpt = interaction.options.getString('필터');
    const filter = filterOpt ?? 'all';
    const container = buildContainerForFilter(filter);
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    console.error('handleEventCommand error:', err);
    await respondError(
      interaction,
      '⚠️ 이벤트 목록을 불러오는 중 오류가 발생했습니다.',
    );
  }
}

export async function handleSetNotifyChannel(interaction) {
  try {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: '서버에서만 사용 가능합니다.',
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel('채널');
    if (!channel) {
      return interaction.reply({
        content: '⚠️ 채널을 찾을 수 없습니다.',
        ephemeral: true,
      });
    }

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    const required = [
      { flag: PermissionsBitField.Flags.ViewChannel, label: '채널 보기' },
      { flag: PermissionsBitField.Flags.SendMessages, label: '메시지 보내기' },
    ];
    const missing = required
      .filter(({ flag }) => !perms?.has(flag))
      .map(({ label }) => label);

    if (missing.length > 0) {
      return interaction.reply({
        content: `⚠️ <#${channel.id}> 채널에서 봇 권한이 부족합니다: ${missing.join(', ')}`,
        ephemeral: true,
      });
    }

    setNotifyChannel(interaction.guildId, channel.id);

    await interaction.reply({
      content: `✅ 알림 채널을 <#${channel.id}>로 설정했습니다.`,
    });
  } catch (err) {
    console.error('handleSetNotifyChannel error:', err);
    await respondError(
      interaction,
      '⚠️ 알림 채널 설정 중 오류가 발생했습니다.',
    );
  }
}
