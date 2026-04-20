import 'dotenv/config';

export const BASE_URL = 'https://www.ff14.co.kr';
export const EVENT_LIST_URL = `${BASE_URL}/news/event?category=1`;

export const CATEGORY_KEYS = ['seasonal', 'limited', 'permanent'];

export const COLORS = {
  MIX: 0x3366cc,
  SEASONAL: 0xff69b4,
  LIMITED: 0xffa500,
  PERMANENT: 0x808080,
  ALERT: 0xff4444,
  EMPTY: 0x999999,
};

const FALLBACK = {
  seasonal: '🎉',
  limited: '🎁',
  permanent: '⚙️',
  unknown: '❓',
  alert: '⏰',
  ff14: '📅',
};

export const EMOJI_IDS = {
  seasonal: process.env.EMOJI_SEASONAL ?? '',
  limited: process.env.EMOJI_LIMITED ?? '',
  permanent: process.env.EMOJI_PERMANENT ?? '',
  unknown: process.env.EMOJI_UNKNOWN ?? '',
  alert: process.env.EMOJI_ALERT ?? '',
  ff14: process.env.EMOJI_FF14 ?? '',
};

export const emojiTag = (key) =>
  EMOJI_IDS[key] ? `<:ff14_${key}:${EMOJI_IDS[key]}>` : FALLBACK[key];

export const CATEGORY_META = {
  seasonal: { key: 'seasonal', label: '시즈널', color: COLORS.SEASONAL },
  limited: { key: 'limited', label: '한정', color: COLORS.LIMITED },
  permanent: { key: 'permanent', label: '상시', color: COLORS.PERMANENT },
  unknown: { key: 'unknown', label: '미분류', color: COLORS.MIX },
};
