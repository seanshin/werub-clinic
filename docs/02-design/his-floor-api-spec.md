# HIS 병원 동선 모니터링 API 명세서

> 작성일: 2026-05-18
> 작성: WeRU.B Clinic 팀
> 대상: HIS 개발팀
> 버전: v1.0

---

## 1. 개요

Clinic 대시보드(`clinic.example.org/dashboard`)에 **병원 동선 모니터링** 기능을 추가합니다.

- 대시보드에 미니 위젯으로 실시간 현황 표시
- 클릭 시 별도 창(`/floor`)에서 전체 평면도 + 상세 분석

**역할 분담:**

| 담당 | 역할 |
|------|------|
| **HIS** | 데이터 제공 (환자/의료진 위치, 통계, 동선 이력) |
| **Clinic** | 시각화 (2D 평면도 렌더링, 히트맵, 동선 플로우) |

Clinic은 HIS가 제공하는 API 데이터를 받아 **시각화만** 수행합니다.
환자 개인정보는 Clinic 측에 저장하지 않으며, 화면 표시 시 마스킹 처리합니다.

---

## 2. 공통 사항

### 2.1 인증

모든 API 요청에 아래 헤더를 포함합니다.

```
Authorization: Bearer {CLINIC_API_KEY}
X-Hospital-Code: {WRB-XXXX-XXXX}
```

- `CLINIC_API_KEY`: 병원 승인 시 발급된 API 키
- `X-Hospital-Code`: 병원 코드

### 2.2 응답 형식

```json
{
  "ok": true,
  "data": { ... },
  "timestamp": "2026-05-18T09:30:00Z"
}
```

에러 시:

```json
{
  "ok": false,
  "error": "에러 메시지",
  "code": "ERROR_CODE"
}
```

### 2.3 Base URL

```
https://his.example.org
```

---

## 3. API 목록

| # | Method | Endpoint | 설명 | 우선순위 |
|---|--------|----------|------|---------|
| 1 | GET | `/api/floor/plans` | 층 목록 | P1 |
| 2 | GET | `/api/floor/plans/:floorId` | 층 평면도 데이터 | P1 |
| 3 | GET | `/api/floor/zones/:floorId` | 구역 목록 | P1 |
| 4 | GET | `/api/floor/entities/:floorId` | 현재 환자/의료진 위치 | P1 |
| 5 | SSE | `/api/floor/stream/:floorId` | 실시간 위치 스트림 | P2 |
| 6 | GET | `/api/floor/stats/:floorId` | 구역별 실시간 통계 | P1 |
| 7 | GET | `/api/floor/stats/:floorId/summary` | 층 전체 요약 (위젯용) | P1 |
| 8 | GET | `/api/floor/flow/:floorId` | 시간대별 동선 흐름 | P2 |
| 9 | GET | `/api/floor/history/:entityId` | 특정 환자/의료진 이동 이력 | P3 |
| 10 | GET | `/api/floor/alerts/:floorId` | 현재 활성 알림 | P3 |

**우선순위:**
- P1: 대시보드 위젯 + 기본 평면도 표시에 필수 (6개)
- P2: 실시간 스트림 + 동선 분석 (2개)
- P3: 개별 이력 + 알림 (2개)

---

## 4. API 상세

### 4.1 층 목록

병원의 층(floor) 목록을 반환합니다.

```
GET /api/floor/plans
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "floors": [
      {
        "id": "1f",
        "name": "1층",
        "description": "외래 진료",
        "zoneCount": 8,
        "hasMapData": true
      },
      {
        "id": "2f",
        "name": "2층",
        "description": "입원실 / 수술",
        "zoneCount": 12,
        "hasMapData": true
      },
      {
        "id": "3f",
        "name": "3층",
        "description": "재활센터 / 상담",
        "zoneCount": 5,
        "hasMapData": false
      }
    ]
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 층 고유 ID |
| `name` | string | 표시 이름 |
| `description` | string | 층 설명 |
| `zoneCount` | number | 해당 층 구역 수 |
| `hasMapData` | boolean | 평면도 데이터 존재 여부 |

---

### 4.2 층 평면도 데이터

특정 층의 평면도 데이터를 반환합니다. Clinic에서 2D 캔버스에 렌더링할 때 사용합니다.

```
GET /api/floor/plans/:floorId
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "floorId": "1f",
    "name": "1층",
    "grid": {
      "cols": 40,
      "rows": 30
    },
    "walls": [
      { "x": 0, "y": 0, "w": 40, "h": 1 },
      { "x": 0, "y": 0, "w": 1, "h": 30 }
    ],
    "doors": [
      { "x": 5, "y": 0, "w": 2, "h": 1 },
      { "x": 15, "y": 10, "w": 1, "h": 2 }
    ],
    "backgroundImage": "https://his.example.org/assets/floor-plans/1f.png",
    "updatedAt": "2026-05-10T14:00:00Z"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `grid` | object | 격자 크기 (cols x rows) |
| `walls` | array | 벽 위치/크기 (렌더링 힌트) |
| `doors` | array | 출입구 위치 (동선 표시용) |
| `backgroundImage` | string? | 평면도 배경 이미지 URL (선택) |

> **참고:** `backgroundImage`가 제공되면 격자 위에 배경으로 깔아서 렌더링합니다. 없으면 `walls`/`doors` 데이터로 평면도를 그립니다.

---

### 4.3 구역 목록

특정 층의 구역(접수, 대기실, 진료실 등) 정보를 반환합니다.

```
GET /api/floor/zones/:floorId
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "zones": [
      {
        "id": "z-reception",
        "name": "접수",
        "type": "reception",
        "capacity": 5,
        "bounds": { "x": 2, "y": 3, "w": 4, "h": 3 },
        "color": "#3B82F6"
      },
      {
        "id": "z-waiting-1",
        "name": "내과 대기실",
        "type": "waiting",
        "capacity": 20,
        "bounds": { "x": 8, "y": 3, "w": 6, "h": 5 },
        "color": "#F59E0B"
      },
      {
        "id": "z-treatment-1",
        "name": "진료실 1 (내과)",
        "type": "treatment",
        "capacity": 1,
        "bounds": { "x": 16, "y": 3, "w": 4, "h": 4 },
        "color": "#10B981"
      },
      {
        "id": "z-treatment-2",
        "name": "진료실 2 (외과)",
        "type": "treatment",
        "capacity": 1,
        "bounds": { "x": 16, "y": 8, "w": 4, "h": 4 },
        "color": "#10B981"
      },
      {
        "id": "z-lab",
        "name": "검사실",
        "type": "lab",
        "capacity": 3,
        "bounds": { "x": 22, "y": 3, "w": 5, "h": 4 },
        "color": "#8B5CF6"
      },
      {
        "id": "z-pharmacy",
        "name": "약국",
        "type": "pharmacy",
        "capacity": 10,
        "bounds": { "x": 30, "y": 3, "w": 5, "h": 4 },
        "color": "#EF4444"
      }
    ]
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 구역 고유 ID |
| `name` | string | 구역 이름 |
| `type` | string | 구역 유형 (아래 표 참조) |
| `capacity` | number | 최대 수용 인원 |
| `bounds` | object | 격자 좌표 (x, y, w, h) |
| `color` | string? | 표시 색상 (선택, 없으면 type별 기본색 사용) |

**구역 유형(type):**

| type | 설명 | 기본 색상 |
|------|------|----------|
| `reception` | 접수 | 파랑 |
| `waiting` | 대기실 | 노랑 |
| `treatment` | 진료실 | 초록 |
| `lab` | 검사실 | 보라 |
| `pharmacy` | 약국 | 빨강 |
| `surgery` | 수술실 | 빨강 |
| `ward` | 입원실 | 파랑 |
| `nurse_station` | 간호스테이션 | 초록 |
| `rehab` | 재활 | 주황 |
| `other` | 기타 | 회색 |

---

### 4.4 현재 환자/의료진 위치

특정 층의 현재 환자 및 의료진 위치를 반환합니다.

```
GET /api/floor/entities/:floorId
```

**Query Parameters:**

| 파라미터 | 타입 | 설명 | 기본값 |
|---------|------|------|--------|
| `type` | string? | 필터 (`patient`, `doctor`, `nurse`, `staff`) | 전체 |

**Response:**

```json
{
  "ok": true,
  "data": {
    "entities": [
      {
        "id": "p-001",
        "type": "patient",
        "label": "김O수",
        "zoneId": "z-waiting-1",
        "status": "waiting",
        "waitMinutes": 18,
        "arrivedAt": "2026-05-18T09:12:00Z",
        "department": "내과"
      },
      {
        "id": "p-002",
        "type": "patient",
        "label": "이O미",
        "zoneId": "z-treatment-1",
        "status": "in-treatment",
        "waitMinutes": 0,
        "arrivedAt": "2026-05-18T09:05:00Z",
        "department": "내과"
      },
      {
        "id": "s-012",
        "type": "doctor",
        "label": "박의사",
        "zoneId": "z-treatment-1",
        "status": "in-treatment",
        "department": "내과",
        "speciality": "내과 전문의"
      },
      {
        "id": "s-023",
        "type": "nurse",
        "label": "최간호사",
        "zoneId": "z-waiting-1",
        "status": "active",
        "department": "내과"
      }
    ],
    "totalPatients": 23,
    "totalStaff": 8,
    "timestamp": "2026-05-18T09:30:00Z"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 엔티티 고유 ID |
| `type` | string | `patient` / `doctor` / `nurse` / `staff` |
| `label` | string | 표시 이름 (**마스킹 처리된 상태로 제공**) |
| `zoneId` | string | 현재 위치 구역 ID |
| `status` | string | 현재 상태 (아래 표 참조) |
| `waitMinutes` | number? | 현재 대기 시간 (분), 환자만 |
| `arrivedAt` | string? | 도착(접수) 시간 |
| `department` | string? | 진료과 |
| `speciality` | string? | 전문분야 (의료진만) |

**상태(status):**

| status | 대상 | 설명 |
|--------|------|------|
| `waiting` | 환자 | 대기 중 |
| `in-treatment` | 환자/의사 | 진료 중 |
| `in-lab` | 환자 | 검사 중 |
| `moving` | 환자 | 이동 중 |
| `completed` | 환자 | 진료 완료 (약국/퇴원 대기) |
| `active` | 의료진 | 근무 중 |
| `break` | 의료진 | 휴식 |
| `off-duty` | 의료진 | 비번 |

> **개인정보 보호:** `label` 필드는 HIS에서 마스킹 처리하여 전달 (예: "김O수"). Clinic은 추가 마스킹 없이 그대로 표시합니다.

---

### 4.5 실시간 위치 스트림 (SSE)

특정 층의 위치 변경 이벤트를 실시간으로 수신합니다.

```
GET /api/floor/stream/:floorId
Accept: text/event-stream
```

**이벤트 유형:**

#### `move` — 구역 이동

```
event: move
data: {"entityId":"p-001","fromZoneId":"z-waiting-1","toZoneId":"z-treatment-1","status":"in-treatment","timestamp":"2026-05-18T09:33:00Z"}
```

#### `enter` — 신규 입장 (접수)

```
event: enter
data: {"entityId":"p-045","type":"patient","label":"박O진","zoneId":"z-reception","department":"외과","timestamp":"2026-05-18T09:35:00Z"}
```

#### `leave` — 퇴원/퇴근

```
event: leave
data: {"entityId":"p-003","zoneId":"z-pharmacy","reason":"completed","timestamp":"2026-05-18T09:40:00Z"}
```

#### `stats` — 통계 갱신 (30초 주기)

```
event: stats
data: {"zoneId":"z-waiting-1","currentCount":12,"avgWaitMinutes":18,"congestion":"high","timestamp":"2026-05-18T09:30:30Z"}
```

#### `alert` — 알림 발생

```
event: alert
data: {"id":"a-001","type":"wait_exceeded","zoneId":"z-waiting-1","message":"내과 대기실 평균 대기 30분 초과","severity":"warning"}
```

> **폴링 대안:** SSE 구현이 어려운 경우, API #4 (`GET /api/floor/entities`)를 **10~30초 간격으로 폴링**하는 방식도 가능합니다. 이 경우 Clinic에서 diff를 계산하여 화면을 갱신합니다.

---

### 4.6 구역별 실시간 통계

특정 층의 모든 구역에 대한 통계를 반환합니다.

```
GET /api/floor/stats/:floorId
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "stats": [
      {
        "zoneId": "z-reception",
        "zoneName": "접수",
        "currentCount": 3,
        "capacity": 5,
        "avgWaitMinutes": 5,
        "maxWaitMinutes": 8,
        "congestion": "normal",
        "todayTotal": 67
      },
      {
        "zoneId": "z-waiting-1",
        "zoneName": "내과 대기실",
        "currentCount": 12,
        "capacity": 20,
        "avgWaitMinutes": 18,
        "maxWaitMinutes": 35,
        "congestion": "high",
        "todayTotal": 45
      },
      {
        "zoneId": "z-treatment-1",
        "zoneName": "진료실 1",
        "currentCount": 1,
        "capacity": 1,
        "avgWaitMinutes": 0,
        "maxWaitMinutes": 0,
        "congestion": "normal",
        "todayTotal": 23
      }
    ],
    "timestamp": "2026-05-18T09:30:00Z"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `currentCount` | number | 현재 해당 구역 인원 |
| `capacity` | number | 최대 수용 인원 |
| `avgWaitMinutes` | number | 평균 대기 시간 (분) |
| `maxWaitMinutes` | number | 최대 대기 시간 (분) |
| `congestion` | string | 혼잡도 (`low` / `normal` / `high` / `critical`) |
| `todayTotal` | number | 오늘 해당 구역 거쳐간 총 인원 |

**혼잡도 기준 (권장):**

| congestion | 조건 |
|------------|------|
| `low` | currentCount < capacity * 0.3 |
| `normal` | currentCount < capacity * 0.7 |
| `high` | currentCount < capacity |
| `critical` | currentCount >= capacity |

---

### 4.7 층 전체 요약 (대시보드 위젯용)

Clinic 대시보드의 미니 위젯에서 사용하는 요약 데이터입니다.

```
GET /api/floor/stats/:floorId/summary
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "floorId": "1f",
    "floorName": "1층",
    "totalPatients": 23,
    "totalStaff": 8,
    "avgWaitMinutes": 18,
    "bottleneck": {
      "zoneId": "z-waiting-1",
      "zoneName": "내과 대기실",
      "currentCount": 12,
      "avgWaitMinutes": 18
    },
    "congestion": "high",
    "zonesSummary": [
      { "zoneId": "z-reception", "name": "접수", "count": 3, "congestion": "normal" },
      { "zoneId": "z-waiting-1", "name": "대기", "count": 12, "congestion": "high" },
      { "zoneId": "z-treatment-1", "name": "진료1", "count": 1, "congestion": "normal" },
      { "zoneId": "z-treatment-2", "name": "진료2", "count": 1, "congestion": "normal" },
      { "zoneId": "z-pharmacy", "name": "약국", "count": 2, "congestion": "low" }
    ],
    "timestamp": "2026-05-18T09:30:00Z"
  }
}
```

| 필드 | 설명 |
|------|------|
| `totalPatients` | 현재 층 전체 환자 수 |
| `totalStaff` | 현재 층 전체 의료진 수 |
| `avgWaitMinutes` | 층 전체 평균 대기 시간 |
| `bottleneck` | 가장 혼잡한 구역 |
| `congestion` | 층 전체 혼잡도 |
| `zonesSummary` | 구역별 간략 현황 (위젯 표시용) |

**Clinic 대시보드 위젯 사용 예시:**

```
┌── 병원 동선 ─────────────────────────────┐
│  1F  환자 23명  의료진 8명  평균 대기 18분  │
│  [접수 ●3] → [대기 ●●12] → [진료 ●2]     │
│  병목: 내과 대기실 (12명)    [전체보기 →]  │
└──────────────────────────────────────────┘
```

---

### 4.8 시간대별 동선 흐름

특정 시간 범위의 구역 간 이동 패턴을 반환합니다. 동선 플로우 화살표 표시에 사용됩니다.

```
GET /api/floor/flow/:floorId?from={HH:mm}&to={HH:mm}&date={YYYY-MM-DD}
```

**Query Parameters:**

| 파라미터 | 타입 | 설명 | 기본값 |
|---------|------|------|--------|
| `from` | string | 시작 시간 (HH:mm) | 오늘 00:00 |
| `to` | string | 종료 시간 (HH:mm) | 현재 시간 |
| `date` | string? | 날짜 (YYYY-MM-DD) | 오늘 |

**Response:**

```json
{
  "ok": true,
  "data": {
    "flows": [
      {
        "fromZoneId": "z-reception",
        "fromZoneName": "접수",
        "toZoneId": "z-waiting-1",
        "toZoneName": "내과 대기실",
        "count": 45,
        "avgTransitMinutes": 2
      },
      {
        "fromZoneId": "z-waiting-1",
        "fromZoneName": "내과 대기실",
        "toZoneId": "z-treatment-1",
        "toZoneName": "진료실 1",
        "count": 18,
        "avgTransitMinutes": 1
      },
      {
        "fromZoneId": "z-waiting-1",
        "fromZoneName": "내과 대기실",
        "toZoneId": "z-treatment-2",
        "toZoneName": "진료실 2",
        "count": 15,
        "avgTransitMinutes": 1
      },
      {
        "fromZoneId": "z-treatment-1",
        "fromZoneName": "진료실 1",
        "toZoneId": "z-lab",
        "toZoneName": "검사실",
        "count": 8,
        "avgTransitMinutes": 3
      },
      {
        "fromZoneId": "z-lab",
        "fromZoneName": "검사실",
        "toZoneId": "z-pharmacy",
        "toZoneName": "약국",
        "count": 6,
        "avgTransitMinutes": 5
      }
    ],
    "period": {
      "date": "2026-05-18",
      "from": "09:00",
      "to": "12:00"
    },
    "totalMovements": 92
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `fromZoneId` | string | 출발 구역 |
| `toZoneId` | string | 도착 구역 |
| `count` | number | 이동 횟수 |
| `avgTransitMinutes` | number | 평균 이동 시간 (분) |

> Clinic에서는 이 데이터를 평면도 위에 **화살표 두께**(count 비례)로 시각화합니다.

---

### 4.9 특정 환자/의료진 이동 이력

특정 개인의 하루 이동 이력을 반환합니다.

```
GET /api/floor/history/:entityId?date={YYYY-MM-DD}
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "entityId": "p-001",
    "type": "patient",
    "label": "김O수",
    "department": "내과",
    "date": "2026-05-18",
    "movements": [
      {
        "zoneId": "z-reception",
        "zoneName": "접수",
        "enterAt": "2026-05-18T09:12:00Z",
        "leaveAt": "2026-05-18T09:15:00Z",
        "durationMinutes": 3
      },
      {
        "zoneId": "z-waiting-1",
        "zoneName": "내과 대기실",
        "enterAt": "2026-05-18T09:15:00Z",
        "leaveAt": "2026-05-18T09:33:00Z",
        "durationMinutes": 18
      },
      {
        "zoneId": "z-treatment-1",
        "zoneName": "진료실 1",
        "enterAt": "2026-05-18T09:33:00Z",
        "leaveAt": "2026-05-18T09:50:00Z",
        "durationMinutes": 17
      },
      {
        "zoneId": "z-lab",
        "zoneName": "검사실",
        "enterAt": "2026-05-18T09:52:00Z",
        "leaveAt": "2026-05-18T10:05:00Z",
        "durationMinutes": 13
      },
      {
        "zoneId": "z-pharmacy",
        "zoneName": "약국",
        "enterAt": "2026-05-18T10:08:00Z",
        "leaveAt": "2026-05-18T10:15:00Z",
        "durationMinutes": 7
      }
    ],
    "totalMinutes": 63,
    "totalWaitMinutes": 18
  }
}
```

---

### 4.10 현재 활성 알림

특정 층에서 발생 중인 알림 목록을 반환합니다.

```
GET /api/floor/alerts/:floorId
```

**Query Parameters:**

| 파라미터 | 타입 | 설명 | 기본값 |
|---------|------|------|--------|
| `severity` | string? | 필터 (`info`, `warning`, `critical`) | 전체 |
| `active` | boolean? | 활성 알림만 | true |

**Response:**

```json
{
  "ok": true,
  "data": {
    "alerts": [
      {
        "id": "a-001",
        "type": "wait_exceeded",
        "severity": "warning",
        "zoneId": "z-waiting-1",
        "zoneName": "내과 대기실",
        "message": "평균 대기 시간 30분 초과",
        "threshold": 30,
        "currentValue": 35,
        "createdAt": "2026-05-18T09:45:00Z"
      },
      {
        "id": "a-002",
        "type": "capacity_exceeded",
        "severity": "critical",
        "zoneId": "z-waiting-1",
        "zoneName": "내과 대기실",
        "message": "정원(20명) 초과: 현재 23명",
        "threshold": 20,
        "currentValue": 23,
        "createdAt": "2026-05-18T09:50:00Z"
      }
    ]
  }
}
```

**알림 유형(type):**

| type | 설명 | 기본 threshold |
|------|------|---------------|
| `wait_exceeded` | 평균 대기 시간 초과 | 30분 |
| `capacity_exceeded` | 구역 정원 초과 | 구역별 capacity |
| `no_staff` | 구역에 의료진 없음 | 0명 |
| `long_treatment` | 진료 시간 초과 | 60분 |

---

## 5. 데이터 소스 가이드

HIS에서 환자/의료진 위치 데이터를 수집하는 방법에 대한 가이드입니다.

### 5.1 환자 위치 추적 방법

| 방법 | 정확도 | 구현 난이도 | 설명 |
|------|--------|-----------|------|
| **접수 시스템 연동** | 구역 단위 | 낮음 | 접수/수납 시 위치 갱신 |
| **키오스크 연동** | 구역 단위 | 낮음 | 대기번호 발급/호출 시 위치 갱신 |
| **전자차트(EMR) 연동** | 구역 단위 | 중간 | 진료 시작/종료 시 위치 갱신 |
| **RFID/비콘** | 좌표 단위 | 높음 | 실시간 위치 추적 (하드웨어 필요) |

> **권장:** Phase 1에서는 접수/EMR 연동만으로 **구역(Zone) 단위** 추적 구현. 좌표 수준 정밀 추적은 Phase 2에서 RFID/비콘 도입 시 확장.

### 5.2 의료진 위치 추적

| 방법 | 설명 |
|------|------|
| 출퇴근 시스템 | 출근 시 층/부서 자동 배정 |
| EMR 로그인 | 진료실 PC 로그인 시 위치 갱신 |
| 수동 입력 | 모바일 앱에서 현재 위치 갱신 |

---

## 6. 에러 코드

| HTTP | code | 설명 |
|------|------|------|
| 400 | `INVALID_FLOOR` | 존재하지 않는 층 ID |
| 400 | `INVALID_ENTITY` | 존재하지 않는 엔티티 ID |
| 400 | `INVALID_TIME_RANGE` | 잘못된 시간 범위 |
| 401 | `UNAUTHORIZED` | API 키 인증 실패 |
| 403 | `FORBIDDEN` | 해당 병원 접근 권한 없음 |
| 404 | `NOT_FOUND` | 리소스 없음 |
| 429 | `RATE_LIMIT` | 요청 제한 초과 |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류 |

---

## 7. 연동 일정 (제안)

| Phase | 기간 | HIS 작업 | Clinic 작업 |
|-------|------|----------|-------------|
| P1 | 2주 | API #1~4, #6~7 구현 | 대시보드 위젯 + 기본 평면도 |
| P2 | 2주 | API #5 (SSE), #8 (동선) | 실시간 스트림 + 히트맵 + 플로우 |
| P3 | 1주 | API #9~10 (이력/알림) | 개별 이력 + 알림 패널 |
| 검증 | 1주 | 통합 테스트 | UI 검증 |

---

## 8. 문의

- Clinic 기술 담당: contact@example.org
- 기술 문서: `docs/02-design/clinic-his-api-spec.md` (기존 HIS 연동 명세)
