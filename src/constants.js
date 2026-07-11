export const BASE_URL = 'https://www.ff14.co.kr';
export const EVENT_LIST_URL = `${BASE_URL}/news/event?category=1`;
export const ENDED_EVENT_LIST_URL = `${BASE_URL}/news/event?category=2`;

export const CATEGORY_KEYS = ['seasonal', 'limited', 'permanent'];

// 종료 임박 알림 ledger 의 단일 kind. 이벤트당 평생 최대 1회 발송을 보장한다.
// 19:00 D-1 job, 09:00 D-0 catch-up, 알림채널 설정 catch-up 이 모두 이 kind 를 공유해
// 하나라도 발송되면 나머지가 hasNotified 로 억제된다.
export const ENDING_ALERT_KIND = 'ending';

export const COLORS = {
  MIX: 0x3366cc,
  SEASONAL: 0xff69b4,
  LIMITED: 0xffa500,
  PERMANENT: 0x808080,
  ALERT: 0xff4444,
  EMPTY: 0x999999,
};

export const BRAND_EMOJI = '📅';

export const CATEGORY_META = {
  seasonal:  { key: 'seasonal',  label: '시즈널', color: COLORS.SEASONAL,  emoji: '🎉' },
  limited:   { key: 'limited',   label: '한정',   color: COLORS.LIMITED,   emoji: '🎁' },
  permanent: { key: 'permanent', label: '상시',   color: COLORS.PERMANENT, emoji: '⚙️' },
  unknown:   { key: 'unknown',   label: '미분류', color: COLORS.MIX,       emoji: '✔︎' },
};
