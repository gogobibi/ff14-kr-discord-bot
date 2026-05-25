import 'dotenv/config';
import { buildBatchPrompt, validateBatchOutput } from './classifiers/prompt.js';
import { callGemini } from './classifiers/gemini.js';
import { callDeepSeek } from './classifiers/deepseek.js';

const PROVIDERS = {
  gemini: callGemini,
  deepseek: callDeepSeek,
};

const DEFAULT_BATCH_SIZE = 3;

function getProvider() {
  const name = (process.env.CLASSIFIER_PROVIDER || 'deepseek').toLowerCase();
  const fn = PROVIDERS[name];
  if (!fn) {
    throw new Error(
      `Unknown CLASSIFIER_PROVIDER='${name}'. Allowed: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  return { name, fn };
}

function getBatchSize() {
  const n = Number(process.env.CLASSIFIER_BATCH_SIZE);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_BATCH_SIZE;
}

export async function classifyEventsBatch(events) {
  if (!Array.isArray(events) || events.length === 0) return [];

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    return events.map(() => ({
      category: null,
      reason: 'config error: ' + err.message,
    }));
  }

  const batchSize = getBatchSize();
  const out = [];
  for (let i = 0; i < events.length; i += batchSize) {
    const chunk = events.slice(i, i + batchSize);
    const prompt = buildBatchPrompt(chunk);
    try {
      const parsed = await provider.fn(prompt);
      const validated = validateBatchOutput(parsed, chunk.length);
      out.push(...validated);
    } catch (err) {
      for (let j = 0; j < chunk.length; j++) {
        out.push({
          category: null,
          reason: `API error (${provider.name}): ${err.message}`,
        });
      }
    }
  }
  return out;
}

// ---------- ESM 단독 실행 블록 / self-test ----------

if (import.meta.url === `file://${process.argv[1]}`) {
  const provider = (process.env.CLASSIFIER_PROVIDER || 'deepseek').toLowerCase();
  const batchSize = getBatchSize();
  console.log(`[info] CLASSIFIER_PROVIDER=${provider} CLASSIFIER_BATCH_SIZE=${batchSize}`);

  const cases = [
    {
      id: 'C-CL1',
      expected: 'seasonal',
      expectedWelcome: false,
      input: {
        title: '신생제 2026',
        description:
          '에오르제아에 새해의 시작을 알리는 신생제가 돌아왔습니다. 기간 한정 의상과 보상을 획득하세요.',
        start_date: '2026-03-31',
        end_date: '2026-04-13',
      },
    },
    {
      id: 'C-CL2',
      expected: 'permanent',
      expectedWelcome: true,
      input: {
        title: '친구 초대 혜택',
        description:
          '친구를 FF14로 초대하고 초대자·초대된 친구 모두에게 주어지는 상시 보상을 받아보세요.',
        start_date: '2025-07-15',
        end_date: '2030-12-31',
      },
    },
    {
      id: 'C-CL3',
      expected: 'limited',
      expectedWelcome: false,
      input: {
        title: '모그모그★컬렉션',
        description:
          '기간 한정으로 돌아오는 모그모그★컬렉션. 이번 시즌 한정 보상을 수집하세요.',
        start_date: '2026-04-01',
        end_date: '2026-04-28',
      },
    },
    {
      id: 'C-CL4',
      expected: 'permanent',
      expectedWelcome: false,
      input: {
        title: 'FFXIV × MONSTER HUNTER WILDS',
        description: '몬스터헌터 와일즈 콜라보 이벤트. 한정 보상을 획득하세요.',
        start_date: '2025-12-16',
        end_date: '2030-12-31',
      },
    },
    {
      id: 'C-CL5',
      expected: 'limited',
      expectedWelcome: true,
      input: {
        title: '강화된 복귀 혜택',
        description: '복귀하는 모험가를 위한 기간 한정 혜택. 다양한 성장 보상이 제공됩니다.',
        start_date: '2026-04-28',
        end_date: '2026-05-25',
      },
    },
  ];

  const expectedCalls = Math.ceil(cases.length / batchSize);
  console.log(`[info] ${cases.length} cases → ${expectedCalls} API call(s) at batch=${batchSize}`);

  const t0 = Date.now();
  const results = await classifyEventsBatch(cases.map((c) => c.input));
  const elapsed = Date.now() - t0;

  let pass = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const out = results[i];
    const catMatch = out.category === c.expected;
    const welMatch = out.is_welcome === c.expectedWelcome;
    const match = catMatch && welMatch;
    if (match) pass++;
    const tag = match ? 'PASS' : 'FAIL';
    console.log(
      `[${tag}] ${c.id} expected=${c.expected}/welcome=${c.expectedWelcome} got=${out.category}/welcome=${out.is_welcome}`,
    );
    console.log(`        reason: ${out.reason}`);
  }

  console.log(
    `\n=== ${pass}/${cases.length} PASS (provider=${provider}, ${expectedCalls} call(s), ${elapsed}ms) ===`,
  );
  if (pass < cases.length) process.exit(1);
}
