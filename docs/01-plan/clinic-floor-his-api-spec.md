<!-- Created: 2026-06-06 -->
# HIS API 추가 요청 명세 — 병원 동선 시각화 (P2/P3)

> 대상: HIS 개발팀 | 목적: `clinic.example.org/floor` 동선 흐름·실시간·자동이슈 시각화에 필요한 신규 API
> 관련 기획: [clinic-floor-flow-visualization.plan.md](./clinic-floor-flow-visualization.plan.md)

---

## 0. 공통 규약

- **베이스**: HIS 서버. WeRU.B 메인앱이 `/api/clinic/his/*` → HIS `/api/*` 로 **캐치올 프록시**(`[...path]`) → **신규 JSON 엔드포인트는 메인앱 변경 없이 자동 통과**.
- **인증 헤더** (WeRU.B `hisProxy`가 자동 부여, HIS는 검증/격리만):
  - `Authorization: Bearer {HIS_API_KEY}`
  - `X-Hospital-Code: {병원코드}` ← **테넌트 격리 키** (반드시 이 병원 데이터만 반환)
  - `X-User-Id: {userId}`
- **응답 규약** (기존 floor 엔드포인트와 동일):
  - 성공 `{ "ok": true, "data": { ... } }`
  - 실패 `{ "ok": false, "error": "메시지" }` (클라이언트는 실패 시 mock 폴백)
- **시간**: ISO 8601 UTC (`2026-06-06T01:02:33Z`)
- **존 ID**: 기존 `zones/{floorId}` 응답의 `zone.id`와 **동일 식별자** 사용
- **좌표계**: 기존 `zone.bounds`와 **동일 격자 단위**(1격자=정수)

### 기존 엔드포인트 (참고 — 변경 없음)
`floor/plans`, `floor/zones/{floorId}`, `floor/entities/{floorId}`, `floor/stats/{floorId}`, `floor/stats/{floorId}/summary`, `floor/history/{entityId}`

---

## 1. ⭐⭐⭐ 존간 전이 집계 (OD Matrix) — 흐름선/Sankey

```
GET /api/floor/flows/{floorId}?window=60&from=&to=
```
- **query**: `window`(분, 집계창, 기본 60) · `from`/`to`(ISO, 선택 — 미지정 시 최근 window분)
- **response.data**:
```json
{
  "floorId": "F3",
  "windowMinutes": 60,
  "generatedAt": "2026-06-06T01:00:00Z",
  "flows": [
    { "fromZone": "reception-1", "toZone": "waiting-A", "count": 42, "avgMinutes": 3.2, "p90Minutes": 7 },
    { "fromZone": "waiting-A", "toZone": "treatment-2", "count": 30, "avgMinutes": 18.5, "p90Minutes": 45 }
  ]
}
```
- `count`: 해당 창에서 fromZone→toZone 이동 건수(흐름선 두께) · `avgMinutes`: 평균 소요 · `p90Minutes`(선택): 지연 판정용

## 2. ⭐⭐⭐ 실시간 이동 이벤트 (SSE) — 부드러운 실시간 애니메이션

```
GET /api/floor/events/{floorId}        (Content-Type: text/event-stream)
```
- 이동/입장/퇴장 발생마다 1 이벤트:
```
event: move
data: {"entityId":"p-1023","entityType":"patient","fromZone":"waiting-A","toZone":"treatment-2","at":"2026-06-06T01:02:33Z"}

event: enter
data: {"entityId":"p-1050","entityType":"patient","toZone":"reception-1","at":"2026-06-06T01:02:40Z"}

event: leave
data: {"entityId":"p-1001","entityType":"patient","fromZone":"pharmacy-1","at":"2026-06-06T01:02:45Z"}
```
- **heartbeat**: `: ping` 15초 권장 (프록시 타임아웃 방지)
- ⚠️ **WeRU.B 동반작업**: 메인앱 `hisProxy`는 현재 JSON 일괄(`res.json()`) → **SSE 패스스루 분기 추가 필요**. HIS는 표준 SSE만 제공하면 됨.

## 3. ⭐⭐ 존 토폴로지 (인접·경로) — 흐름선을 실제 복도로 라우팅

```
GET /api/floor/topology/{floorId}
```
```json
{
  "floorId": "F3",
  "nodes": [ { "zoneId": "reception-1", "door": { "x": 12.5, "y": 3.0 } } ],
  "edges": [
    { "a": "reception-1", "b": "waiting-A", "polyline": [[12.5,3.0],[14,6],[18,6]], "distance": 9.4, "bidirectional": true }
  ]
}
```
- `polyline`: 복도/통로 경로점 배열(격자 좌표) — 흐름선을 직선이 아닌 실제 경로로 그림

## 4. ⭐⭐ 층 단위 이력 일괄 — 리플레이/OD 산출

```
GET /api/floor/history/{floorId}?from=&to=&types=patient&cursor=
```
- 기존 `history/{entityId}`의 **층 전체·기간** 버전
```json
{
  "floorId": "F3", "from": "...", "to": "...", "nextCursor": null,
  "entities": [
    { "entityId": "p-1023", "label": "환자A", "type": "patient",
      "movements": [ { "zoneId": "waiting-A", "zoneName": "대기A", "enterAt": "...", "leaveAt": "...", "durationMinutes": 12 } ] }
  ]
}
```
- 대용량 → `cursor` 페이지네이션 또는 상한 권장

## 5. ⭐⭐ 존별 SLA/기대치 — "원활하지 않음" 자동 판정

```
GET /api/floor/sla/{floorId}
```
```json
{
  "floorId": "F3",
  "zones": [
    { "zoneId": "waiting-A", "targetWaitMinutes": 15, "targetThroughputPerHour": 40, "maxCapacity": 20,
      "expectedByHour": [ { "hour": 9, "expectedCount": 18 }, { "hour": 10, "expectedCount": 25 } ] }
  ]
}
```
- 실제 대기/처리량이 목표·기대 초과 시 자동 "지연" 표시. `expectedByHour`는 선택(있으면 시간대 baseline 비교).

## 6. ⭐ 흐름 차단/이슈 컨텍스트

```
GET /api/floor/issues/{floorId}
```
```json
{
  "issues": [
    { "scope": "zone", "zoneId": "treatment-2", "type": "equipment_down", "severity": "high", "since": "...", "note": "CT 점검중" },
    { "scope": "entity", "entityId": "p-1099", "zoneId": "ward-3", "type": "isolation", "severity": "medium" }
  ]
}
```
- `type` 예: `equipment_down` · `isolation` · `urgent` · `staff_shortage` · `blocked`
- (대안: 기존 `entities`/`stats` 응답에 사유 태그 필드로 인라인 제공도 가능)

## 7. ⭐ 엔티티 정밀 좌표 (RTLS 보유 시)

- 기존 `entities/{floorId}` 응답의 각 엔티티에 **선택 필드** 추가:
```json
{ "id": "p-1023", "zoneId": "waiting-A", "x": 14.2, "y": 6.8, "heading": 90, "updatedAt": "..." }
```
- 없으면 존 단위 유지(현행). 있으면 부드러운 이동 보간 정밀도↑.

## 8. ⭐⭐ 예약/예정 동선 (Scheduled Flow) — "예정 방향 표시등"

> 환자별 **다음 행선지 예약/오더**를 받아 평면도에 "예정 화살표 + 시각"으로 표시.
> (현재 클라이언트는 OD `flows` 전이확률로 **통계 예측**을 점선 표시 중 — 본 API는 **확정 예약**으로 정확도↑)

```
GET /api/floor/schedule/{floorId}
```
```json
{
  "floorId": "F3",
  "schedules": [
    { "entityId": "p-1023", "currentZone": "waiting-A", "nextZone": "treatment-2",
      "scheduledAt": "2026-06-06T05:30:00Z", "orderType": "consult", "status": "scheduled" },
    { "entityId": "p-1050", "currentZone": "treatment-2", "nextZone": "lab-1",
      "scheduledAt": "2026-06-06T05:45:00Z", "orderType": "lab", "status": "ordered" }
  ]
}
```
- `nextZone`: 다음 예정 구역 · `scheduledAt`: 예정 시각(임박 시 강조) · `orderType`: consult/lab/imaging/pharmacy/admission 등 · `status`: scheduled/ordered/in_progress
- 출처: HIS 예약·오더·워크플로우 큐. 없으면 클라이언트 통계 예측(점선)으로 폴백.

---

## 단계별 요청 우선순위

| 단계 | HIS 신규 | 효과 |
|------|----------|------|
| **P2** | **#1 flows**, #4 층 history | 정식 흐름선·Sankey·리플레이 |
| **P3** | **#2 events(SSE)**, #5 SLA, #3 topology | 실시간 애니메이션·자동 이슈감지·경로 라우팅 |
| **P4** | **#8 schedule** | 예약/예정 동선 — 확정 "예정 방향 표시등"(현재는 통계 예측 점선) |
| 선택 | #6 issues, #7 좌표(RTLS) | 이슈 의미·보간 정밀도 |

## WeRU.B 측 동반 작업

- **#2 SSE만** 메인앱 `hisProxy`에 `text/event-stream` 패스스루 분기 필요
- 나머지 JSON 엔드포인트(#1,3,4,5,6)는 **캐치올 프록시로 자동 통과 — 메인앱 변경 불필요**, 프론트(`floor.ts` fetch 함수 + `FloorCanvas` 렌더)만 추가
