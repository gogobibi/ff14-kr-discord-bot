# Classifier provider 추상화 + 배치 호출

이벤트 카테고리 분류 LLM 호출을 `src/classifiers/{provider}.js` Strategy 모듈로 분리하고, 환경변수 `CLASSIFIER_PROVIDER` (기본 `deepseek`) 로 런타임 선택한다. 한 사이클의 모든 unclassified 이벤트는 N건씩 묶어 1회 호출(`CLASSIFIER_BATCH_SIZE`, 기본 3)로 처리한다. 동기: Gemini free tier 일일 20건 한도를 첫 사이클부터 초과한 사례 + 향후 provider 교체 자유도 확보.

## Considered Options

- **Single-call per event (이전)**: 11건 unclassified = 11 호출. 한도 초과 즉시 발생.
- **Short-circuit rule** (종료일 1년+ 즉시 permanent, LLM 호출 skip): 효과적이지만 prompt 룰과 중복. 폐기.
- **Batch (N건 = 1 호출)** ← 채택: 호출량 1/N 절감. chunk 단위 partial-success 가능. token 한도는 chunk 작게 잡아 회피.

## Consequences

- **호출 정확도 회귀 시 chunk 통째로 실패** — 한 chunk 내 N건 모두 `category=NULL` 반환. 다음 cron 에서 `getUnclassifiedEvents` 가 자동 재시도.
- **batch size 조정 = `.env` 의 `CLASSIFIER_BATCH_SIZE`** — 토큰 한도 / 결과 누락 사이 트레이드오프.
- **Provider 추가 비용 = 모듈 1개 + `PROVIDERS` 맵 한 줄.** `prompt.js` 의 SYSTEM_PROMPT·validate 는 provider 공유.
