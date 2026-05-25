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

export const BRAND_EMOJI = '📅';

export const CATEGORY_META = {
  seasonal:  { key: 'seasonal',  label: '시즈널', color: COLORS.SEASONAL,  emoji: '🎉' },
  limited:   { key: 'limited',   label: '한정',   color: COLORS.LIMITED,   emoji: '🎁' },
  permanent: { key: 'permanent', label: '상시',   color: COLORS.PERMANENT, emoji: '⚙️' },
  unknown:   { key: 'unknown',   label: '미분류', color: COLORS.MIX,       emoji: '✔︎' },
};
