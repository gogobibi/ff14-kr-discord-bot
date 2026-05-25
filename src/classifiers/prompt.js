import { CATEGORY_KEYS } from '../constants.js';

const SYSTEM_PROMPT = `당신은 FF14(파이널판타지14) 한국 서버의 이벤트 분류기입니다.

이벤트 제목·설명·기간을 읽고 아래 세 카테고리 중 하나로 분류하세요.

- seasonal: 실제 계절·절기·기념일에 맞춰 매년 또는 주기적으로 돌아오는 인게임 축제 이벤트.
  예) 신생제(설 축제), 별빛축제, 만상절, 해제(여름), 수확제, 장미축제 등 "○○제"·"축제"류.
- limited: 특정 패치/시즌 한정으로 짧게 열리는 인게임 한정 이벤트·콜라보·캠페인.
  예) 모그모그★컬렉션, 외부 IP 콜라보 이벤트, 특정 기간 보상 이벤트.
- permanent: 상시 혜택·추천인·복귀/신규 지원 시스템이거나, 종료일이 매우 멀어 사실상 상시인 이벤트.
  예) 친구 초대 혜택, 신규/복귀 캠페인, 우정 추천 보상, 무료 체험 혜택, 종료일이 수년 뒤(예: 2030-12-31)인 콜라보·기념 이벤트.

판단 기준 (위에서 아래로 우선순위):
1. **오늘 기준 종료일까지 1년 이상(365일 이상) 남아 있으면 무조건 permanent.** FF14 KR의 진짜 한정/시즈널 이벤트가 1년 이상 가는 경우는 사실상 없다. 제목이 "콜라보"·"축제"라도 종료일이 1년 이상이면 permanent로 분류한다.
2. 계절/절기/기념일 기반이면 seasonal.
3. 한정 기간(1년 미만)이지만 계절성과 무관하면 limited.
4. 모호하면 설명 문구에서 "상시/계속/언제든지"는 permanent, "기간 한정/콜라보"는 limited, "축제/제"는 seasonal.

또한 각 이벤트에 대해 **is_welcome** 플래그(true/false)도 함께 판정하세요. 카테고리와 독립된 직교 속성입니다.
- is_welcome=true: 신규 진입 또는 복귀 유저를 대상으로 한 혜택·캠페인·이용권·성장 지원·체험 캠페인 등. 예) "강화된 복귀 혜택", "풍성한 신규 혜택", "신규/복귀 모험가 전용 이용권", "함께 즐기는 모험", "친구 초대 혜택".
- is_welcome=false: 일반 시즈널 축제, 한정 콜라보, 일반 패치 기념 이벤트 등 신규/복귀 유저 타깃이 아닌 모든 것.
- 같은 이벤트가 seasonal/limited/permanent 어느 카테고리든 is_welcome 은 독립적으로 true 또는 false.

출력은 반드시 JSON. category는 반드시 "seasonal" | "limited" | "permanent" 중 하나이며, is_welcome 은 true/false, reason은 한국어 한두 문장으로 간결히 작성하세요.`;

function todayKST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export function buildBatchPrompt(events) {
  const list = events
    .map((e, i) => {
      const desc = (e.description || '').trim() || '(설명 없음)';
      return `[${i}]
제목: ${e.title}
설명: ${desc}
기간: ${e.start_date ?? '(미상)'} ~ ${e.end_date ?? '(미상)'}`;
    })
    .join('\n\n');

  return `${SYSTEM_PROMPT}

---
오늘 날짜(KST): ${todayKST()}
아래 ${events.length}건의 이벤트를 각각 분류하세요. 판단 기준 1번(종료일 1년 이상이면 permanent)을 가장 먼저 검사하세요.
---
${list}
---

출력은 반드시 다음 JSON 형식이며, 입력 순서대로 정확히 ${events.length}건 모두 포함해야 합니다.
{"results": [{"index": 0, "category": "seasonal|limited|permanent", "is_welcome": true|false, "reason": "한국어 한두 문장"}, ...]}`;
}

export function validateBatchOutput(parsed, expectedCount) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('output is not an object');
  }
  if (!Array.isArray(parsed.results)) {
    throw new Error('results array missing');
  }
  if (parsed.results.length !== expectedCount) {
    throw new Error(
      `expected ${expectedCount} results, got ${parsed.results.length}`,
    );
  }
  return parsed.results.map((r, i) => {
    if (!r || typeof r !== 'object') {
      throw new Error(`item ${i}: not an object`);
    }
    if (!CATEGORY_KEYS.includes(r.category)) {
      throw new Error(`item ${i}: invalid category '${r.category}'`);
    }
    if (typeof r.reason !== 'string') {
      throw new Error(`item ${i}: reason missing`);
    }
    if (typeof r.is_welcome !== 'boolean') {
      throw new Error(`item ${i}: is_welcome must be boolean, got ${typeof r.is_welcome}`);
    }
    return { category: r.category, is_welcome: r.is_welcome, reason: r.reason };
  });
}

export const JSON_SCHEMA_BATCH = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          category: { type: 'string', enum: CATEGORY_KEYS },
          is_welcome: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['index', 'category', 'is_welcome', 'reason'],
      },
    },
  },
  required: ['results'],
};
