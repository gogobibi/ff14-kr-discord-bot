import { MessageFlags, PermissionsBitField } from 'discord.js';
import {
  getCurrentEvents,
  getLongTermEvents,
  getLastEventUpdate,
  getPastEvents,
  setNotifyChannel,
  getEventsEndingToday,
  hasNotified,
  markNotified,
} from './storage.js';
import { buildEventListContainer, buildEmptyContainer, buildAlertContainer } from './ui.js';
import { runScrapeNow } from './scheduler.js';
import { ENDING_ALERT_KIND } from './constants.js';

function buildContainerForFilter(filter) {
  const lastUpdate = getLastEventUpdate();
  const lastUpdatedUnix = lastUpdate
    ? Math.floor(new Date(lastUpdate.replace(' ', 'T') + 'Z').getTime() / 1000)
    : null;
  let events;
  if (filter === 'past') {
    events = getPastEvents();
  } else if (filter === 'permanent') {
    events = getLongTermEvents();
  } else {
    events = getCurrentEvents();
  }
  if (events.length === 0) {
    return buildEmptyContainer();
  }
  return buildEventListContainer({
    events,
    filter: filter ?? 'current',
    lastUpdatedUnix,
  });
}

async function respondError(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred) {
      await interaction.editReply(payload);
    } else if (interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    if (err?.code === 40060) {
      try {
        await interaction.followUp(payload);
        return;
      } catch (followUpErr) {
        console.error('Failed to send error response (followUp fallback):', followUpErr);
        return;
      }
    }
    console.error('Failed to send error response:', err);
  }
}

export async function handleEventCommand(interaction) {
  try {
    await interaction.deferReply();
    const filterOpt = interaction.options.getString('필터');
    const filter = filterOpt ?? 'current';
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

export async function handleScrapeNow(interaction) {
  const devGuildId = process.env.DEV_GUILD_ID;
  if (!devGuildId || interaction.guildId !== devGuildId) {
    return interaction.reply({
      content: '⚠️ 이 명령은 개발 서버에서만 사용 가능합니다.',
      flags: MessageFlags.Ephemeral,
    });
  }
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await runScrapeNow();
    if (result.skipped) {
      await interaction.editReply('⏳ 이미 스크래핑이 실행 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    await interaction.editReply(
      `✅ 스크래핑 완료 — 총 ${result.total}건 / upsert ${result.upserts}건 / 분류 ${result.classified}건`,
    );
  } catch (err) {
    console.error('handleScrapeNow error:', err);
    await respondError(interaction, '⚠️ 스크래핑 중 오류가 발생했습니다.');
  }
}

export async function handleSetNotifyChannel(interaction) {
  try {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: '서버에서만 사용 가능합니다.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const channel = interaction.options.getChannel('채널');
    if (!channel) {
      return interaction.reply({
        content: '⚠️ 채널을 찾을 수 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.client.guilds.cache.has(interaction.guildId)) {
      return interaction.reply({
        content: '⚠️ 봇이 이 서버에 참여 중인지 확인할 수 없습니다. 봇을 이 서버에 초대한 뒤 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const perms = interaction.appPermissions ?? channel.permissionsFor(interaction.client.user);
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
        flags: MessageFlags.Ephemeral,
      });
    }

    setNotifyChannel(interaction.guildId, channel.id);

    // D-0 (오늘 종료) 이벤트는 다음 cron 까지 기다리면 놓치므로 즉시 catch-up
    // 신규·복귀 혜택은 catch-up 제외 — 길드 일반 알림에는 부적절
    for (const event of getEventsEndingToday()) {
      if (event.is_welcome) continue;
      if (hasNotified(interaction.guildId, event.id, ENDING_ALERT_KIND)) continue;
      try {
        const container = buildAlertContainer({ event });
        await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        markNotified(interaction.guildId, event.id, ENDING_ALERT_KIND);
      } catch (err) {
        console.warn(`[알림:catch-up] event ${event.id} 발송 실패:`, err.message);
      }
    }

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
