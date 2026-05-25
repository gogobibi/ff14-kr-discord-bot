# "신규/복귀 혜택" 을 카테고리가 아닌 직교 플래그로

"강화된 복귀 혜택", "친구 초대 혜택", "신규/복귀 모험가 전용 이용권" 같은 신규/복귀 유저 타깃 이벤트를 화면 정렬 시 가장 뒤로 빼야 했다. 이 속성을 기존 카테고리(`seasonal/limited/permanent`)에 끼우지 않고 `events.is_welcome` boolean 컬럼으로 분리. 분류기가 카테고리와 함께 판정한다.

## Considered Options

- **(b) 새 카테고리 `welcome` 추가**: 4번째 카테고리. 문제 — "강화된 복귀 혜택"(단기, limited 성격) + "친구 초대 혜택"(상시, permanent 성격) 처럼 카테고리가 충돌하는 사례를 표현 불가. 카테고리는 시간/주기 의미를 잃고 모호해짐.
- **(a) Heuristic regex 만**: title 키워드 (`/복귀|신규/`) 매칭. 단순. "함께 즐기는 모험" 같이 키워드 없는 케이스 못 잡음. LLM 의도 = "별도로 인식" 과 어긋남.
- **(c) `is_welcome` 직교 플래그** ← 채택: 카테고리는 시간/주기 의미 그대로, welcome 은 타깃 유저층 의미로 분리. 같은 이벤트가 `limited + welcome` 가능.

## Consequences

- **마이그레이션**: 기존 DB 는 `initDB()` 의 `migrate()` 가 `ALTER TABLE ADD COLUMN is_welcome` + title 키워드 heuristic 백필. 이후 cron 또는 manual scrape 시 LLM 이 정확한 값으로 덮어씀.
- **정렬 책임은 UI 레이어**: storage 가 raw 데이터 반환, `ui.js sortEvents()` 가 `is_welcome` 기준 2단 정렬(welcome 뒤로 → `end_date`). 모든 필터(`current`/`permanent`/`past`)에 일관 적용. 부수 효과로 `past` 의 정렬 방향 버그(ASC 로 강제되던 것)도 정정.
- **JSON 스키마 확장 + batch validate 강화**: `is_welcome` 누락이나 잘못된 타입을 chunk 단위로 throw → 다음 cron 재시도. 일관성 비용.
- **카테고리 변경 없이 welcome 만 따로 갱신** 같은 동작은 현재 API 표면상 불가능 (`updateEventClassification` 가 둘 다 받음). 필요해지면 분리.
