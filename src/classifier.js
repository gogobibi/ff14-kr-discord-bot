import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CATEGORY_KEYS } from './constants.js';

const MODEL_NAME = 'gemini-2.5-flash-lite';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM_PROMPT = `당신은 FF14(파이널판타지14) 한국 서버의 이벤트 분류기입니다.

이벤트 제목과 설명을 읽고 아래 세 카테고리 중 하나로 분류하세요.

- seasonal: 실제 계절·절기·기념일에 맞춰 매년 또는 주기적으로 돌아오는 인게임 축제 이벤트.
  예) 신생제(설 축제), 별빛축제, 만상절, 해제(여름), 수확제, 장미축제 등 "○○제"·"축제"류.
- limited: 특정 패치/시즌 한정으로 짧게 열리는 인게임 한정 이벤트·콜라보·캠페인.
  예) 모그모그★컬렉션, 외부 IP 콜라보 이벤트, 특정 기간 보상 이벤트.
- permanent: 항상(또는 매우 장기간) 진행되는 상시 혜택·추천인·복귀/신규 지원 시스템.
  예) 친구 초대 혜택, 신규/복귀 캠페인, 우정 추천 보상, 상시 무료 체험 관련 혜택.

판단 기준:
1. 계절/절기/기념일 기반이면 seasonal.
2. 한정 기간이지만 계절성과 무관하면 limited.
3. 종료일이 매우 멀거나 상시 제공이면 permanent.
4. 모호하면 설명의 문구에서 "상시/계속/언제든지"는 permanent, "기간 한정/콜라보"는 limited, "축제/제"는 seasonal로 판단.

출력은 반드시 JSON. category는 반드시 "seasonal" | "limited" | "permanent" 중 하나이며, reason은 한국어 한두 문장으로 간결히 작성하세요.`;

function buildPrompt({ title, description }) {
  const desc = (description || '').trim() || '(설명 없음)';
  return `${SYSTEM_PROMPT}

---
제목: ${title}
설명: ${desc}
---

위 이벤트를 분류하고 JSON을 반환하세요.`;
}

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORY_KEYS },
          reason: { type: 'string' },
        },
        required: ['category', 'reason'],
      },
    },
  });
}

async function callOnce(model, prompt) {
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);
  if (!CATEGORY_KEYS.includes(parsed.category)) {
    throw new Error(`invalid category: ${parsed.category}`);
  }
  if (typeof parsed.reason !== 'string') {
    throw new Error('reason missing');
  }
  return { category: parsed.category, reason: parsed.reason };
}

export async function classifyEvent({ title, description }) {
  let model;
  try {
    model = getModel();
  } catch (err) {
    return { category: null, reason: 'API error: ' + err.message };
  }

  const prompt = buildPrompt({ title, description });

  try {
    return await callOnce(model, prompt);
  } catch (err) {
    await sleep(2000);
    try {
      return await callOnce(model, prompt);
    } catch (err2) {
      return { category: null, reason: 'API error: ' + err2.message };
    }
  }
}

// ---------- ESM 단독 실행 블록 / self-test ----------

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = [
    {
      id: 'C-CL1',
      expected: 'seasonal',
      input: {
        title: '신생제 2026',
        description:
          '에오르제아에 새해의 시작을 알리는 신생제가 돌아왔습니다. 기간 한정 의상과 보상을 획득하세요.',
      },
    },
    {
      id: 'C-CL2',
      expected: 'permanent',
      input: {
        title: '친구 초대 혜택',
        description:
          '친구를 FF14로 초대하고 초대자·초대된 친구 모두에게 주어지는 상시 보상을 받아보세요.',
      },
    },
    {
      id: 'C-CL3',
      expected: 'limited',
      input: {
        title: '모그모그★컬렉션',
        description:
          '기간 한정으로 돌아오는 모그모그★컬렉션. 이번 시즌 한정 보상을 수집하세요.',
      },
    },
  ];

  let pass = 0;
  for (const c of cases) {
    const t0 = Date.now();
    const out = await classifyEvent(c.input);
    const elapsed = Date.now() - t0;
    const match = out.category === c.expected;
    if (match) pass++;
    const tag = match ? 'PASS' : 'FAIL';
    console.log(
      `[${tag}] ${c.id} expected=${c.expected} got=${out.category} (${elapsed}ms)`
    );
    console.log(`        reason: ${out.reason}`);
  }

  console.log(`\n=== ${pass}/${cases.length} PASS ===`);
  if (pass < cases.length) process.exit(1);
}
