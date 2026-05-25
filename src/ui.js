import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

import { COLORS, CATEGORY_META, BRAND_EMOJI } from "./constants.js";

const ONE_DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const FILTER_LABEL = {
  current: "진행 중",
  permanent: "상시",
  past: "이전",
};

function accentColorFor(filter) {
  if (filter === "permanent") return COLORS.PERMANENT;
  if (filter === "past") return COLORS.EMPTY;
  return COLORS.MIX;
}

function sortEvents(events, { dir = "asc" } = {}) {
  return [...events].sort((a, b) => {
    const aw = a.is_welcome ? 1 : 0;
    const bw = b.is_welcome ? 1 : 0;
    if (aw !== bw) return aw - bw;
    const da = new Date(a.end_date).getTime();
    const db = new Date(b.end_date).getTime();
    return dir === "desc" ? db - da : da - db;
  });
}

export function formatDday(endDateISO) {
  const endMs = new Date(endDateISO).getTime();
  const unix = Math.floor(endMs / 1000);

  const nowDay = Math.floor((Date.now() + KST_OFFSET_MS) / ONE_DAY_MS);
  const endDay = Math.floor((endMs + KST_OFFSET_MS) / ONE_DAY_MS);
  const days = endDay - nowDay;

  let badge;
  let endTag = `<t:${unix}:R>`;
  if (days <= 0) {
    badge = "🔥 **오늘 종료!**";
  } else if (days === 1) {
    badge = "⚠️ **D-1**";
  } else if (days <= 7) {
    badge = `⏰ D-${days}`;
  } else if (days <= 365) {
    badge = `📅 D-${days}`;
    endTag = null;
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

function eventListContent(event, { past } = {}) {
  const meta = categoryMeta(event);
  const titleLine = event.url
    ? `### [${event.title}](${event.url})`
    : `### ${event.title}`;
  if (past) {
    const endUnix = Math.floor(new Date(event.end_date).getTime() / 1000);
    return (
      `${titleLine}\n` +
      `${meta.emoji} 종료 <t:${endUnix}:R>\n` +
      `📆 ${fmtDate(event.start_date)} ~ ${fmtDate(event.end_date)}`
    );
  }
  const { badge } = formatDday(event.end_date);
  return (
    `${titleLine}\n` +
    `${meta.emoji} ${badge}\n` +
    `📆 ${fmtDate(event.start_date)} ~ ${fmtDate(event.end_date)}`
  );
}

function appendEventListItem(container, event, opts) {
  const content = eventListContent(event, opts);
  if (event.image_url) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
      .setThumbnailAccessory(
        new ThumbnailBuilder()
          .setURL(event.image_url)
          .setDescription(event.title),
      );
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
  }
}

const MAX_EVENTS_PER_MESSAGE = 6;

export function buildEventListContainer({ events, filter, lastUpdatedUnix }) {
  const container = new ContainerBuilder().setAccentColor(
    accentColorFor(filter),
  );

  const sorted = sortEvents(events, { dir: filter === "past" ? "desc" : "asc" });
  const shown = sorted.slice(0, MAX_EVENTS_PER_MESSAGE);
  const hiddenCount = sorted.length - shown.length;

  const headerLabel =
    filter === "past"
      ? "종료된 이벤트"
      : filter === "permanent"
        ? "상시 이벤트"
        : "진행 중 이벤트";
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${BRAND_EMOJI} FF14 ${headerLabel} (${events.length}개)`,
    ),
  );
  const label = FILTER_LABEL[filter] ?? "진행 중";
  const updatedText = lastUpdatedUnix
    ? `마지막 갱신 <t:${lastUpdatedUnix}:R>`
    : "갱신 정보 없음";
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# 필터: ${label} · ${updatedText}`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const opts = { past: filter === "past" };
  shown.forEach((event, idx) => {
    appendEventListItem(container, event, opts);
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
    ? `### ${meta.emoji} [${event.title}](${event.url})`
    : `### ${meta.emoji} ${event.title}`;
  const sectionBody = [
    titleLine,
    `📆 ${fmtDate(event.start_date)} ~ ${fmtDate(event.end_date)}`,
    endTag,
  ]
    .filter(Boolean)
    .join("\n");

  if (event.image_url) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(sectionBody))
      .setThumbnailAccessory(
        new ThumbnailBuilder()
          .setURL(event.image_url)
          .setDescription(event.title),
      );
    container.addSectionComponents(section);
  } else if (event.url) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(sectionBody))
      .setButtonAccessory(
        new ButtonBuilder()
          .setURL(event.url)
          .setLabel("상세보기")
          .setStyle(ButtonStyle.Link),
      );
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(sectionBody),
    );
  }

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
    filter: "current",
    lastUpdatedUnix: now,
  });
  const empty = buildEmptyContainer();
  const alert = buildAlertContainer({ event: events[0] });
  const past = buildEventListContainer({
    events: [
      {
        id: "evt-past",
        title: "지난 신생제",
        description: null,
        start_date: "2026-03-01",
        end_date: new Date(Date.now() - 7 * ONE_DAY_MS).toISOString(),
        url: "https://www.ff14.co.kr/news/event/old",
        image_url: null,
        category: "seasonal",
      },
    ],
    filter: "past",
    lastUpdatedUnix: now,
  });

  console.log(
    `UI builders OK: list=${list.constructor.name}, empty=${empty.constructor.name}, alert=${alert.constructor.name}, past=${past.constructor.name}`,
  );
}
