import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

import { COLORS, CATEGORY_META, emojiTag } from "./constants.js";

const ONE_DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const FILTER_LABEL = {
  all: "전체",
  seasonal: "시즈널",
  limited: "한정",
  permanent: "상시",
};

function accentColorFor(filter) {
  if (filter === "seasonal") return COLORS.SEASONAL;
  if (filter === "limited") return COLORS.LIMITED;
  if (filter === "permanent") return COLORS.PERMANENT;
  return COLORS.MIX;
}

export function formatDday(endDateISO) {
  const endMs = new Date(endDateISO).getTime();
  const unix = Math.floor(endMs / 1000);

  const nowDay = Math.floor((Date.now() + KST_OFFSET_MS) / ONE_DAY_MS);
  const endDay = Math.floor((endMs + KST_OFFSET_MS) / ONE_DAY_MS);
  const days = endDay - nowDay;

  let badge;
  let endTag;
  if (days <= 0) {
    badge = "🔥 **오늘 종료!**";
    endTag = `<t:${unix}:R>`;
  } else if (days <= 365) {
    badge = `📅 **D-${days}**`;
    endTag = `<t:${unix}:R>`;
  } else {
    badge = "♾️ 장기 이벤트";
    endTag = null;
  }

  return { badge, endTag };
}

function fmtDate(iso) {
  return iso?.slice(0, 10) ?? "";
}

function categoryMeta(event) {
  return CATEGORY_META[event.category] ?? CATEGORY_META.unknown;
}

function buildEventSection(event) {
  const meta = categoryMeta(event);
  const { badge } = formatDday(event.end_date);
  const titleLine = event.url
    ? `### [${event.title}](${event.url})`
    : `### ${event.title}`;
  const content =
    `${titleLine}\n` +
    `${emojiTag(meta.key)} ${badge}\n` +
    `📆 ${fmtDate(event.start_date)} ~ ${fmtDate(event.end_date)}`;

  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );

  if (event.image_url) {
    section.setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(event.image_url)
        .setDescription(event.title),
    );
  } else {
    section.setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(`noop:${event.id}`)
        .setLabel("　")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
  }
  return section;
}

const MAX_EVENTS_PER_MESSAGE = 6;

export function buildEventListContainer({ events, filter, lastUpdatedUnix }) {
  const container = new ContainerBuilder().setAccentColor(
    accentColorFor(filter),
  );

  const sorted = [...events].sort(
    (a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime(),
  );
  const shown = sorted.slice(0, MAX_EVENTS_PER_MESSAGE);
  const hiddenCount = sorted.length - shown.length;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${emojiTag("ff14")} FF14 진행 중 이벤트 (${events.length}개)`,
    ),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# 필터: ${FILTER_LABEL[filter] ?? "전체"} · 마지막 갱신 <t:${lastUpdatedUnix}:R>`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  shown.forEach((event, idx) => {
    container.addSectionComponents(buildEventSection(event));
    if (idx < shown.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }
  });

  if (hiddenCount > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# … 외 ${hiddenCount}건은 종료 임박 순으로 상위 ${MAX_EVENTS_PER_MESSAGE}건만 표시됩니다.`,
      ),
    );
  }

  return container;
}

export function buildEmptyContainer() {
  const container = new ContainerBuilder().setAccentColor(COLORS.EMPTY);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## 📭 진행 중인 이벤트가 없습니다"),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "-# 스크래핑이 아직 실행되지 않았거나\n-# 해당 카테고리에 이벤트가 없습니다.",
    ),
  );
  return container;
}

export function buildAlertContainer({ event }) {
  const container = new ContainerBuilder().setAccentColor(COLORS.ALERT);
  const meta = categoryMeta(event);
  const { badge, endTag } = formatDday(event.end_date);
  const nowUnix = Math.floor(Date.now() / 1000);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${badge}`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const titleLine = event.url
    ? `### ${emojiTag(meta.key)} [${event.title}](${event.url})`
    : `### ${emojiTag(meta.key)} ${event.title}`;
  const sectionBody = [
    titleLine,
    `📆 ${fmtDate(event.start_date)} ~ ${fmtDate(event.end_date)}`,
    endTag,
  ]
    .filter(Boolean)
    .join("\n");

  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(sectionBody),
  );
  if (event.image_url) {
    section.setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(event.image_url)
        .setDescription(event.title),
    );
  } else if (event.url) {
    section.setButtonAccessory(
      new ButtonBuilder()
        .setURL(event.url)
        .setLabel("　")
        .setStyle(ButtonStyle.Link),
    );
  } else {
    section.setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(`noop:${event.id}`)
        .setLabel("　")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
  }
  container.addSectionComponents(section);

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# FF14 KR Bot · 종료 알림 · <t:${nowUnix}:F>`,
    ),
  );

  return container;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const now = Math.floor(Date.now() / 1000);
  const mkEnd = (days) =>
    new Date(Date.now() + days * ONE_DAY_MS).toISOString();

  const events = [
    {
      id: "evt-1",
      title: "신생제",
      description: "미소를 담은 여정의 기억",
      start_date: "2026-03-31",
      end_date: mkEnd(1),
      url: "https://www.ff14.co.kr/news/event/1",
      image_url: "https://www.ff14.co.kr/img/event1.png",
      category: "seasonal",
    },
    {
      id: "evt-2",
      title: "모그모그★컬렉션",
      description: null,
      start_date: "2026-03-31",
      end_date: mkEnd(9),
      url: "https://www.ff14.co.kr/news/event/2",
      image_url: null,
      category: "limited",
    },
    {
      id: "evt-3",
      title: "친구 초대 혜택",
      description: null,
      start_date: "2025-07-15",
      end_date: mkEnd(400),
      url: "https://www.ff14.co.kr/news/event/3",
      image_url: "https://www.ff14.co.kr/img/event3.png",
      category: "permanent",
    },
  ];

  const list = buildEventListContainer({
    events,
    filter: "all",
    lastUpdatedUnix: now,
  });
  const empty = buildEmptyContainer();
  const alert = buildAlertContainer({ event: events[0] });

  console.log(
    `UI builders OK: list=${list.constructor.name}, empty=${empty.constructor.name}, alert=${alert.constructor.name}`,
  );
}
