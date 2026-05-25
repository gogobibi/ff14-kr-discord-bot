# FF14 KR Event Discord Bot

FF14 한국 공식 사이트의 이벤트 페이지를 주기적으로 스크래핑하고 Gemini로 분류하여, Discord 서버에 진행 중 이벤트 조회와 종료 임박 알림을 제공하는 봇.

> 본 문서는 **현재 코드에서 동작 중인 도메인**을 spec으로 기술. `PLAN.md`는 outdated.

## Language

### 이벤트 도메인

**Event**:
FF14 한국 공식 사이트 이벤트 페이지의 한 카드. `id`, `title`, `description`, `start_date`, `end_date`, `url`, `image_url`, `category`, `is_welcome`, `notified_1day` 속성을 가진다.
_Avoid_: 게시물, 콘텐츠

**Category**:
**Event**가 속한 유형. `seasonal` / `limited` / `permanent` / `null`(미분류) 네 가지. **Welcome Flag** 와 직교 — 같은 **Event** 가 limited + welcome 둘 다 가질 수 있다.
_Avoid_: 타입, 분류명

**Welcome Flag** (`is_welcome`):
신규 진입·복귀 유저를 대상으로 한 혜택·캠페인·이용권·성장 지원 여부를 나타내는 boolean. **Category** 와 독립된 직교 속성. UI 정렬 시 `is_welcome=1` 인 이벤트를 모든 필터에서 가장 뒤로 배치한다. 분류기가 카테고리와 함께 판정 (마이그레이션 시 title 의 "복귀"/"신규" 키워드로 heuristic 백필됨). 자세한 결정 근거: [ADR-0002](docs/adr/0002-welcome-flag-orthogonal-to-category.md).

**Unclassified Event**:
`category IS NULL`인 **Event**. 스크래핑 직후 일시적으로 존재하며, 다음 스크래핑 사이클에서 Gemini가 분류해 채움.

**Active Event**:
`start_date <= today(KST) <= end_date` 조건을 만족하는 **Event**.

**Ending-Soon Event**:
`end_date ∈ {today(KST), tomorrow(KST)}` 이고 `notified_1day = 0` 인 **Event**. 종료 임박 알림 대상. `today` 도 포함하는 이유는, 봇/cron 다운 등으로 어제 09:00 알림을 놓친 D-1 케이스를 오늘이라도 catch-up 하기 위함이다.

**notified_1day**:
한 **Event**에 대해 종료 임박 알림을 한 번이라도 발송했는지를 나타내는 boolean(0/1). 알림은 **Event** 당 평생 최대 1회.

### 카테고리 값

**seasonal** — 축제·계절 이벤트 (예: 신생제)
**limited** — 기간 한정 이벤트 (예: 모그모그★컬렉션)
**permanent** — 상시 이벤트, **또는 종료일이 오늘로부터 1년 이상 남은 모든 이벤트** (예: 친구 초대 혜택, `2030-12-31` 종료의 콜라보 이벤트). 분류기의 1순위 규칙. FF14 KR의 진짜 한정/시즈널은 1년 이상 가지 않으므로, 표면상 "콜라보"·"축제" 라도 종료일이 멀면 사실상 상시.
**null** — 아직 분류되지 않음. UI에서 "미분류"로 표시

### 명령어 도메인

**Filter** (`/이벤트 필터:` 옵션):
조회 시 보기 모드를 고르는 옵션. 값 3종 — 옵션 미지정(=`current`) / `permanent` / `past`. `seasonal`·`limited` 같은 LLM 내부 분류 카테고리는 필터로 노출하지 않는다.
- `current` (기본, 라벨 "진행 중"): `permanent`를 제외한 모든 **Active Event**.
- `permanent` (라벨 "상시"): `permanent` 카테고리의 **Active Event**만.
- `past` (라벨 "이전"): `end_date < today(KST)` 인 **Event**를 최근 종료부터 정렬해 표시. D-day 배지 없이 종료 상대시간 (`<t:unix:R>`) 표기.
_Avoid_: `all`, "전체" (이 봇 맥락에서는 `permanent` 포함을 의미하지 않음)

**Notify Channel**:
길드별로 종료 임박 알림을 받을 텍스트 채널. `/이벤트-알림채널`로 길드 관리자가 설정. `guild_config.notify_channel_id` 컬럼에 저장.
_Avoid_: 알림방, broadcast channel

**Guild Config**:
한 길드의 봇 설정 한 행. `guild_id`(PK), `notify_channel_id`(nullable), `added_at`, `updated_at`. 봇이 길드에 합류하면 `notify_channel_id=NULL`로 자동 생성됨.

### 스크래핑·분류·알림

**Scrape Job** (cron `45 17 * * *` + `0 20 * * *` KST — 일 2회):
ff14.co.kr 이벤트 페이지를 가져와 **Event**를 `upsert`하고, 곧바로 **Unclassified Event**를 LLM(`CLASSIFIER_PROVIDER`, 기본 DeepSeek)으로 batch 분류하는 단일 잡. 한 LLM 호출당 `CLASSIFIER_BATCH_SIZE`(기본 3)건씩 묶어 호출. 동시 실행 차단(in-process flag). 자세한 결정 근거: [ADR-0001](docs/adr/0001-classifier-provider-abstraction-and-batching.md).

**시각 근거**: FF14 KR 공식 사이트가 새 이벤트를 KST 17~18시 부근 비정각에 게시하는 경향이 있다. 17:45 가 17:xx 게시 catch, 20:00 이 18:xx~19:xx 게시 catch. 알림(09:00) 직전 catch-up cron 은 없으므로 알림 시점 데이터는 어제 20:00 기준 — best-effort.

**Notify Job** (cron `0 9 * * *` KST):
**Ending-Soon Event** 각각에 대해, **Notify Channel**이 설정된 모든 길드에 알림 컨테이너를 발송하고 `notified_1day=1`로 마킹.

**알림 신뢰성 한계**: cron 이 단 1회/일(09:00 KST)이고 today/tomorrow 두 날짜만 catch-up 한다. 봇/호스트가 연속 2일+ 다운되면 그 기간 종료 이벤트는 알림 누락 — best-effort 정책.

**Manual Scrape** (`/이벤트-스크래핑`, dev 전용):
`DEV_GUILD_ID` 환경변수와 일치하는 길드에서만 노출되는 슬래시 명령. **Scrape Job**과 동일 로직을 즉시 실행.

### UI 도메인 (Discord Components V2)

**Event List Container**:
`/이벤트` 응답으로 만들어지는 Container. 헤더 + 갱신 시각 + 이벤트 Section들. 한 메시지당 최대 6개 (초과 시 "외 N건" 표시).

**Last Event Update**:
DB 내 모든 **Event**의 `updated_at` 중 최댓값. `Event List Container` 헤더에 "마지막 갱신 <t:..:R>"로 표시. 한 번도 스크랩 안 된 경우 "갱신 정보 없음"으로 폴백. **Scrape Job** 시각의 근사치이며 정확한 cron 실행 시각은 아니다 (분류 단계의 `updateEventCategory`도 갱신).

**Alert Container**:
**Notify Job**이 **Ending-Tomorrow Event** 한 건당 하나씩 발송하는 Container. 레드 accent, D-day 배지 헤더, 이벤트 Section, 푸터 타임스탬프.

**D-day Badge**:
**Event**의 `end_date`까지의 일수를 시각화한 배지. 5단계 — `🔥 오늘 종료!` (≤0) / `⚠️ D-1` (1) / `⏰ D-N` (2~7) / `📅 D-N` (8~365) / `♾️ 장기 이벤트` (>365). 1~7일 구간은 Discord 상대시간(`<t:unix:R>`) 병기. `formatDday`에서 KST 기준 계산.

## Relationships

- 한 **Event**는 정확히 하나의 **Category**를 가진다 (분류 전에는 `null`).
- **Scrape Job**이 **Event**를 만들고, 같은 잡 안에서 **Unclassified Event**를 분류한다.
- **Notify Job**은 **Ending-Soon Event** × **Notify Channel** 설정된 모든 **Guild Config** 의 조합으로 발송한다.
- 한 **Guild Config**는 최대 한 개의 **Notify Channel**을 가진다 (nullable).
- **Filter**가 `permanent` 일 때는 정확히 `permanent` **Category**의 **Active Event**만, `past` 일 때는 종료된 모든 **Event** (가장 최근 종료부터), 옵션 미지정(=`current`)이면 `permanent`를 제외한 모든 **Active Event**가 반환된다.

## Flagged ambiguities

- ✅ ~~`all` 필터가 `permanent`를 제외하던 비대칭~~ → **해소**. 식별자 `all` → `current`, 라벨 "전체" → "진행 중"으로 변경. `permanent`(상시)는 chase 대상이 아니어서 기본 조회에서 제외하는 것이 의도된 정책임을 명문화.

## Example dialogue

> **Dev**: "사용자가 `/이벤트` 만 쳤어. 응답에 친구 초대 혜택 같은 **permanent Event**가 들어가야 하나?"
> **도메인 정리 후**: "아니. 옵션 미지정이면 `permanent`는 제외돼. 보고 싶으면 `/이벤트 필터:상시`로 명시적으로 요청해야 한다."
> **Dev**: "그럼 `permanent`인 **Ending-Tomorrow Event**가 있을 때 알림은?"
> **도메인 정리 후**: "발송된다. 알림은 **Filter** 와 무관하게 `end_date == tomorrow` 한 줄로만 결정한다."
