# WeRU.B Clinic ↔ HIS 연동 API 명세서 — Phase 2~5

> Version: 1.1.0
> Date: 2026-05-07
> Base URL: `https://example.org`
> 인증: 모든 API는 `Authorization: Bearer his_xxx` + `X-Hospital-Code: WRB-XXXX-XXXX`

---

## 1. 병원 정보/설정 API

### 1.1 GET /api/clinic/his/hospital

**병원 기본 정보 조회**

#### Response

```json
{
  "id": "cafe-uuid",
  "name": "위루비병원",
  "code": "WRB-DEMO-M66M",
  "type": "hospital",
  "status": "active",
  "businessNumber": "000-00-00000",
  "representative": "홍원장",
  "specialty": "종합병원",
  "contactEmail": "contact@example.org",
  "contactPhone": "010-9972-1760",
  "staffCount": 25,
  "hisEnabled": true,
  "features": {
    "board": true,
    "calendar": true,
    "sharespace": true,
    "attendance": true,
    "wsign": true,
    "organization": true,
    "leave": true,
    "okr": false,
    "knowledgeAi": false
  },
  "createdAt": "2026-05-06T00:00:00Z"
}
```

---

### 1.2 GET /api/clinic/his/hospital/settings

**HIS 연동 설정 조회**

#### Response

```json
{
  "sso": {
    "enabled": true,
    "tokenTtlSeconds": 30
  },
  "checklist": {
    "enabled": true,
    "autoShowOnCheckin": true,
    "requiredBeforeWork": false
  },
  "notifications": {
    "channelEnabled": true,
    "pushEnabled": true,
    "urgentChannelName": "emergency"
  },
  "calendar": {
    "syncEnabled": true,
    "syncIntervalMinutes": 15
  },
  "wsign": {
    "autoApproverLookup": true,
    "callbackUrl": "https://his.example.org/api/v1/webhooks/wsign"
  },
  "organization": {
    "syncEnabled": true,
    "lastSyncAt": "2026-05-07T08:00:00Z"
  }
}
```

---

### 1.3 PUT /api/clinic/his/hospital/settings

**HIS 연동 설정 수정**

#### Request

```json
{
  "checklist": {
    "autoShowOnCheckin": true,
    "requiredBeforeWork": true
  },
  "wsign": {
    "callbackUrl": "https://his.example.org/api/v1/webhooks/wsign"
  }
}
```

> 전달한 키만 업데이트됩니다 (부분 수정 가능).

#### Response

```json
{ "ok": true, "message": "설정이 저장되었습니다" }
```

---

## 2. 알림 API (Phase 2)

### 2.1 POST /api/clinic/his/notify

**HIS → Clinic 알림 전송**

직원에게 알림을 발송합니다. Clinic 알림 센터에 표시되며, FCM 푸시도 발송됩니다.

#### Request

```json
{
  "recipients": ["user-uuid-001"],
  "title": "검사 결과 확인",
  "message": "이OO 환자 혈액검사 결과가 도착했습니다. 이상 수치: WBC 12,000",
  "priority": "normal",
  "link": "https://his.example.org/lab/results/lab-001",
  "category": "lab_result",
  "metadata": {
    "patientId": "patient-001",
    "resultId": "lab-result-001"
  }
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| recipients | string[] | ✅ | 수신자 ID 목록. `["all"]`은 전체, `["department:내과"]`는 부서 |
| title | string | ✅ | 알림 제목 |
| message | string | ✅ | 알림 내용 |
| priority | string | | `low` / `normal` / `high` / `urgent` (기본: normal) |
| link | string | | 클릭 시 이동 URL (HIS 페이지) |
| category | string | | `lab_result` / `prescription` / `admission` / `emergency` / `surgery` / `general` |
| metadata | object | | 추가 데이터 (자유 형식) |

#### Response

```json
{
  "ok": true,
  "sent": 1,
  "notificationIds": ["notif-uuid-001"]
}
```

---

### 2.2 POST /api/clinic/his/notify/urgent

**긴급 알림** — 알림 + 채널 메시지 + 푸시 동시 발송

#### Request

```json
{
  "channel": "emergency",
  "title": "🚨 응급 환자 입원",
  "message": "KTAS 1등급 환자 입원. 심정지, CPR 진행 중.\n담당: 김의사 · 위치: 응급실",
  "assignees": ["user-uuid-001", "user-uuid-002"],
  "priority": "urgent"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| channel | string | ✅ | 메시지 전송 채널명 (없으면 자동 생성) |
| title | string | ✅ | 제목 |
| message | string | ✅ | 내용 (마크다운 지원) |
| assignees | string[] | | 담당자 (개인 알림 추가 발송) |
| priority | string | | 항상 `urgent` 권장 |

#### Response

```json
{
  "ok": true,
  "notificationsSent": 2,
  "channelMessageId": "msg-uuid-001"
}
```

---

### 2.3 GET /api/clinic/his/notify/history

**발송 알림 이력 조회**

#### Query Parameters

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| limit | number | 조회 건수 (기본: 50, 최대: 200) |
| offset | number | 페이지 오프셋 |
| category | string | 카테고리 필터 |
| since | string | ISO8601 날짜 이후 |

#### Response

```json
{
  "notifications": [
    {
      "id": "notif-uuid-001",
      "title": "검사 결과 확인",
      "message": "이OO 환자 혈액검사 결과...",
      "category": "lab_result",
      "priority": "normal",
      "recipients": ["user-uuid-001"],
      "readBy": ["user-uuid-001"],
      "createdAt": "2026-05-07T10:00:00Z"
    }
  ],
  "total": 142
}
```

---

## 3. 채널 메시지 API (Phase 2)

### 3.1 GET /api/clinic/his/channels

**병원 채널 목록 조회**

#### Response

```json
{
  "channels": [
    {
      "id": "ch-uuid-001",
      "name": "내과-공지",
      "type": "announcement",
      "memberCount": 12,
      "lastMessageAt": "2026-05-07T09:30:00Z"
    },
    {
      "id": "ch-uuid-002",
      "name": "emergency",
      "type": "general",
      "memberCount": 30,
      "lastMessageAt": "2026-05-07T08:15:00Z"
    }
  ],
  "total": 8
}
```

---

### 3.2 POST /api/clinic/his/channel/message

**채널에 메시지 전송**

#### Request

```json
{
  "channelId": "ch-uuid-001",
  "content": "**[검사 결과 알림]**\n이OO 환자 CT 판독 결과:\n- 소견: 정상 소견\n- 판독의: 박영상",
  "sender": "system",
  "attachments": [
    {
      "name": "CT_report.pdf",
      "url": "https://his.example.org/files/ct-report-001.pdf",
      "size": 245000,
      "type": "application/pdf"
    }
  ],
  "threadId": null
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| channelId | string | ✅ | 채널 ID (또는 `channelName`으로 이름 지정) |
| channelName | string | | 채널명 (channelId 대신 사용 가능) |
| content | string | ✅ | 메시지 본문 (마크다운 지원) |
| sender | string | | `system` 또는 userId (기본: system) |
| attachments | array | | 첨부파일 목록 |
| threadId | string | | 스레드 답글 시 부모 메시지 ID |

#### Response

```json
{
  "ok": true,
  "messageId": "msg-uuid-001",
  "channelId": "ch-uuid-001"
}
```

---

### 3.3 POST /api/clinic/his/channel/handoff

**인수인계 노트 전송** — 전용 인수인계 채널에 구조화된 노트를 전송합니다.

#### Request

```json
{
  "from": "user-uuid-001",
  "to": ["user-uuid-002"],
  "shift": "night_to_day",
  "department": "내과",
  "patients": [
    {
      "patientId": "patient-001",
      "name": "이OO",
      "room": "302",
      "summary": "혈압 상승 추이 관찰 필요. 22시 BP 160/95",
      "priority": "high",
      "tasks": ["06:00 BP 재측정", "아침 회진 시 약 조절 검토"]
    },
    {
      "patientId": "patient-002",
      "name": "김OO",
      "room": "305",
      "summary": "수술 후 1일차. 통증 VAS 3/10. 안정적.",
      "priority": "normal",
      "tasks": ["드레싱 확인"]
    }
  ],
  "generalNotes": "야간 특이사항 없음. 신규 입원 1건 (303호 박OO, 폐렴)."
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| from | string | ✅ | 인수인계 작성자 ID |
| to | string[] | ✅ | 인수 받는 직원 ID 목록 |
| shift | string | ✅ | `night_to_day` / `day_to_evening` / `evening_to_night` |
| department | string | | 부서명 |
| patients | array | | 환자별 인수인계 내용 |
| generalNotes | string | | 전체 특이사항 |

#### Response

```json
{
  "ok": true,
  "messageId": "msg-uuid-handoff-001",
  "channelName": "내과-인수인계"
}
```

---

## 4. 캘린더/근태 API (Phase 3)

### 4.1 POST /api/clinic/his/calendar/sync

**HIS 일정 → Clinic 캘린더 동기화**

#### Request

```json
{
  "events": [
    {
      "externalId": "his-surgery-001",
      "title": "이OO 환자 담낭절제술",
      "type": "surgery",
      "startTime": "2026-05-07T09:00:00+09:00",
      "endTime": "2026-05-07T12:00:00+09:00",
      "assignees": ["user-uuid-001", "user-uuid-002"],
      "location": "수술실 2",
      "priority": "high",
      "metadata": {
        "patientId": "patient-001",
        "procedureCode": "47562"
      }
    }
  ],
  "deleteIds": ["his-old-event-001"]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| events[].externalId | string | HIS측 고유 ID (중복 시 업데이트) |
| events[].type | string | `surgery` / `appointment` / `duty` / `meeting` / `other` |
| events[].assignees | string[] | 참여자 Clinic ID |
| deleteIds | string[] | 삭제할 externalId 목록 |

#### Response

```json
{ "ok": true, "synced": 1, "deleted": 1, "errors": [] }
```

---

### 4.2 GET /api/clinic/his/calendar/events

**Clinic 캘린더 일정 조회**

#### Query Parameters

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| start | string | 시작 날짜 (YYYY-MM-DD) |
| end | string | 종료 날짜 |
| userId | string | 특정 직원 필터 |
| type | string | 일정 유형 필터 |

#### Response

```json
{
  "events": [
    {
      "id": "cal-uuid-001",
      "externalId": "his-surgery-001",
      "title": "이OO 환자 담낭절제술",
      "type": "surgery",
      "startTime": "2026-05-07T09:00:00+09:00",
      "endTime": "2026-05-07T12:00:00+09:00",
      "assignees": [
        { "userId": "user-uuid-001", "username": "김의사", "rsvp": "accepted" }
      ],
      "location": "수술실 2"
    }
  ],
  "total": 5
}
```

---

### 4.3 GET /api/clinic/his/schedule/duty

**당직/교대 근무표 조회**

#### Query Parameters

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| weekOf | string | 주간 시작 날짜 (YYYY-MM-DD, 기본: 이번 주 월요일) |
| department | string | 부서 필터 |

#### Response

```json
{
  "weekOf": "2026-05-05",
  "schedule": [
    {
      "date": "2026-05-07",
      "dayOfWeek": "수",
      "shifts": [
        { "shift": "day", "time": "07:00-15:00", "staff": [{ "userId": "user-001", "username": "김간호", "hisRole": "Nurse" }] },
        { "shift": "evening", "time": "15:00-23:00", "staff": [{ "userId": "user-002", "username": "이간호", "hisRole": "Nurse" }] },
        { "shift": "night", "time": "23:00-07:00", "staff": [{ "userId": "user-003", "username": "박간호", "hisRole": "Nurse" }] },
        { "shift": "duty", "time": "종일", "staff": [{ "userId": "user-010", "username": "최의사", "hisRole": "Doctor", "department": "내과" }] }
      ]
    }
  ]
}
```

---

### 4.4 PUT /api/clinic/his/schedule/duty

**당직표 수정** — HIS에서 당직표 변경 시 Clinic 캘린더에 반영

#### Request

```json
{
  "date": "2026-05-07",
  "shift": "duty",
  "staff": [
    { "userId": "user-010", "department": "내과" }
  ],
  "reason": "교대 변경 — 김의사 → 최의사"
}
```

---

### 4.5 GET /api/clinic/his/attendance

**오늘 전체 직원 출퇴근 현황**

#### Response

```json
{
  "date": "2026-05-07",
  "summary": { "total": 25, "checkedIn": 18, "onLeave": 3, "notYet": 4 },
  "staff": [
    { "userId": "user-001", "username": "김의사", "status": "checked_in", "checkInAt": "2026-05-07T08:15:00Z", "department": "내과" },
    { "userId": "user-002", "username": "이간호", "status": "on_vacation", "checkInAt": null, "department": "내과" }
  ]
}
```

---

### 4.6 GET /api/clinic/his/leave

**직원 연차 현황**

#### Query Parameters

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| userId | string | 특정 직원 (생략 시 전체) |
| year | number | 연도 (기본: 올해) |

#### Response

```json
{
  "staff": [
    {
      "userId": "user-001",
      "username": "김의사",
      "totalDays": 15,
      "usedDays": 5,
      "remainingDays": 10,
      "pendingRequests": 1
    }
  ]
}
```

---

## 5. 전자결재 API (Phase 4)

### 5.1 POST /api/clinic/his/wsign/request

**HIS 문서 → W.Sign 기안 생성**

> **연동 대상 (2026-07-17 명시)**: **Clinic(병원 워크스페이스) 전자결재** — W.Channel 전자결재와 무관(조직체계 상이). 문서·결재선은 HIS API 키에 바인딩된 병원 카페 스코프, 결재선 추천은 HIS 조직도 기준. `viewUrl` 호스트는 `example.org` 정본 고정(호출 origin 미사용) — clinic 대시보드 "전자결재" 링크가 여는 화면과 동일.

#### Request

```json
{
  "templateId": "medical-purchase",
  "title": "의료소모품 구매 요청 — 주사기 1,000개",
  "drafter": "user-uuid-003",
  "approvers": null,
  "autoApproverType": "purchase",
  "content": {
    "items": [
      { "name": "일회용 주사기 3cc", "quantity": 1000, "unitPrice": 150, "total": 150000 },
      { "name": "알코올 솜", "quantity": 500, "unitPrice": 50, "total": 25000 }
    ],
    "totalAmount": 175000,
    "reason": "재고 부족 — 안전재고 이하",
    "urgency": "normal"
  },
  "callbackUrl": "https://his.example.org/api/v1/webhooks/wsign",
  "attachments": [
    { "name": "견적서.pdf", "url": "https://his.example.org/files/quote-001.pdf" }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| templateId | string | | W.Sign 양식 ID (없으면 기본 양식) |
| title | string | ✅ | 결재 제목 |
| drafter | string | ✅ | 기안자 Clinic ID |
| approvers | string[] | | 결재자 지정 (null이면 자동 추천) |
| autoApproverType | string | | 자동 결재선: `general`/`purchase`/`leave`/`medical` |
| content | object | ✅ | 결재 내용 (양식에 따라 자유 형식) |
| callbackUrl | string | | 결재 완료 시 콜백 URL |
| attachments | array | | 첨부파일 |
| externalRef | string | | **멱등키** (2026-07-16) — 동일 키 재상신 시 새 문서를 만들지 않고 기존 문서 반환(`idempotent: true`). `Idempotency-Key` 헤더로도 전달 가능(헤더 우선) |

> `approvers`가 null이고 `autoApproverType`이 지정되면 **조직도 API**에서 자동으로 결재선을 구성합니다.

#### templateId 카탈로그 (docType 분류 매핑, 2026-07-16 확정)

| templateId | 분류 | 비고 |
|------------|------|------|
| `leave` | 인사 | 휴가 |
| `attendance_correction` | 인사 | **근태정정 (신설)** |
| `overtime` | 인사 | **초과근무 (신설)** |
| `leave_cancel` | 인사 | **휴가취소 (신설)** |
| `purchase` | 재무 | 구매 |
| `medical` | 의료 | 의료 |
| `general` / 미지정·기타 값 | 기타 | |

> 하이픈/언더스코어는 동등 취급(`leave-cancel` == `leave_cancel`). `content`는 자유 형식이므로 템플릿별 필드 강제는 없음 — 위 3종 신설은 분류·문서함 필터 목적.

#### Response

```json
{
  "ok": true,
  "docId": "wsign-doc-uuid-001",
  "status": "pending",
  "approvalLine": [
    { "step": 1, "userId": "user-002", "username": "이수간호", "status": "pending" },
    { "step": 2, "userId": "user-001", "username": "김과장", "status": "waiting" }
  ]
}
```

---

### 5.2 GET /api/clinic/his/wsign/status/:docId

**결재 진행 상태 조회**

#### Response

```json
{
  "docId": "wsign-doc-uuid-001",
  "title": "의료소모품 구매 요청",
  "status": "approved",
  "drafter": { "userId": "user-003", "username": "박간호" },
  "approvalLine": [
    { "step": 1, "userId": "user-002", "username": "이수간호", "status": "approved", "approvedAt": "2026-05-07T10:00:00Z", "comment": "확인" },
    { "step": 2, "userId": "user-001", "username": "김과장", "status": "approved", "approvedAt": "2026-05-07T11:30:00Z", "comment": "" }
  ],
  "createdAt": "2026-05-07T09:00:00Z",
  "completedAt": "2026-05-07T11:30:00Z"
}
```

| status | 설명 |
|--------|------|
| `pending` | 결재 진행 중 (보류 포함) |
| `approved` | 최종 승인 |
| `rejected` | 반려 |
| `withdrawn` | 기안자 회수/취소 |

> **2026-07-16 갱신**: 응답에 `docNumber`·`currentStep`(1-based, `approvalLine`의 `step`과 동일 기준 — 진행 중이 아니면 null)·`rawStatus`(W.Sign 내부 한글 상태)·결재선 항목별 `role`/`rawStatus`/`approvedBy`(대결 시 실제 처리자) 필드 추가. 결재선 status는 `pending`(현재 차례)/`waiting`/`approved`/`rejected` 4종.

---

### 5.3 결과 콜백 (callbackUrl 직접 방식 — 2026-07-16 확정 규격)

상신 시 전달한 `callbackUrl`로 결재 결과를 POST 통지. **W.Sign→HIS 결재 결과의 정본 경로**(7장 구독 웹훅과 별개 — wsign 이벤트는 이 경로 사용).

#### 이벤트

| event | 트리거 |
|-------|--------|
| `wsign.approved` | 최종 승인 |
| `wsign.rejected` | 반려 |
| `wsign.withdrawn` | 기안자 회수(recall)/취소(cancel) — **2026-07-16 신설** |

#### 페이로드

```json
{
  "event": "wsign.approved",
  "eventId": "evt-wsign-his-1752...-abcd-approved-m1x2y3",
  "timestamp": "2026-07-16T10:30:00Z",
  "hospitalCode": "WRB-DEMO-M66M",
  "data": {
    "docId": "wsign-his-...",
    "docNumber": "인사-2026-0012",
    "title": "휴가 신청 — 홍길동",
    "drafter": { "userId": "user-003", "username": "박간호" },
    "approvedBy": { "userId": "user-001", "username": "김과장" },
    "status": "approved",
    "completedAt": "2026-07-16T10:30:00Z"
  },
  "signature": "sha256=a1b2c3..."
}
```

- **`eventId` = 멱등키**: 동일 발생 건의 재시도는 같은 값 → HIS는 eventId로 중복 수신 dedup.
- 반려 시 `rejectedBy`, 회수 시 `withdrawnBy` (동일 `{userId, username}` 형식).
- **재시도**: 실패 시 3회 (10초 / 60초 / 300초 간격), best-effort.

> **규격 고정 (2026-07-17, HIS 확인 요청 2건 회신)**
> ① 서명 값은 **`sha256=` 접두 포함이 정본** — 헤더 `X-Clinic-Signature`와 body `signature` 필드 모두 `sha256=<64자리 hex>` 형식(동일 값).
> ② `eventId`는 **페이로드 최상위 필드가 정본** — `data.eventId` 아님. `data` 내부에는 eventId를 넣지 않음.

#### HMAC 서명 검증 (HIS측) — 2026-07-17 표준 웹훅 방식으로 확정

서명 시크릿이 등록된 경우(아래 5.4), **body는 순수 페이로드(위 JSON 그대로)이고 서명은 헤더로만** 전송합니다(body에 `signature` 필드 없음 — GitHub/Stripe 방식). 검증 = **수신한 raw body 전체를 그대로 HMAC**:

```javascript
const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const valid = crypto.timingSafeEqual(Buffer.from(req.headers["x-clinic-signature"]), Buffer.from(expected));
```

- 헤더: `X-Clinic-Signature: sha256=hex(HMAC-SHA256(secret, rawBody))`. 재직렬화·필드 제거 불필요 — **전송 body 전체가 곧 서명 대상**.
- ⚠️ **2026-07-17 변경**: 이전 규약(body에 `signature` 필드 삽입 + 후미 치환 검증)은 폐기. HIS 수신부가 "원문 body HMAC"으로 검증하면 삽입된 필드 때문에 불일치(401)하던 것을 리허설에서 실측 확인해 표준 방식으로 통일. **HIS는 위 3줄 검증만 하면 됨.**

시크릿 미등록 시 서명 없이 발송(하위호환) — **운영 개통 전 시크릿 등록 필수**.

### 5.4-α 열람 SSO (viewUrl 재로그인 없는 열람 — 2026-07-17 신설)

HIS 포털에서 결재 문서를 열 때 재로그인 없이 W.Sign 화면 진입:

```
① HIS 백엔드:  POST /api/clinic/his/sso-ticket        (기존 API 키 인증, 권한 staff)
   { "userId": "clinicUserId" 또는 "email": "...", "redirect": "/cafes/{slug}/wsign?doc=..." }
   → 200 { ok, ssoUrl: "https://example.org/api/clinic/his/sso-login?ticket=...", expiresIn: 60, redirect }
② 브라우저:    ssoUrl 열기 (새 탭/이동)
   → 세션 쿠키(.example.org) 발급 후 redirect로 302 → 문서 즉시 열람
```

- **티켓 = 단회용·60초 TTL·해시 저장**. redirect는 발급 시 티켓에 바인딩(상대경로만 — 교환 시 쿼리 무시). 실패(만료/재사용) 시 로그인 페이지로 안내.
- 대상 = 병원(또는 연결 채널 워크스페이스) 소속 직원만. 플랫폼 관리자 계정 발급 불가. 발급·교환 모두 감사 로그.
- **자동 생성 계정(비밀번호 없음)도 이 경로로 결재함 접근 가능** — 리허설 결재자 접근 D안(권장 승격): HIS 포털에서 결재자에게 ssoUrl 전달로 충분.

### 5.4 PUT /api/clinic/his/callback-secret — 콜백 서명 시크릿 등록/로테이션

HIS가 자기 API 키 인증(`wsign` 권한)으로 콜백 서명 시크릿을 자체 관리. AES-256-GCM 암호화 저장.

| 메서드 | 동작 |
|--------|------|
| `PUT` | `{ "secret": "16자 이상" }` — 등록/로테이션 (즉시 이후 콜백부터 적용) |
| `GET` | `{ "configured": true, "updatedAt": "..." }` (시크릿 값 미반환) |
| `DELETE` | 삭제 (이후 미서명 발송) |

**로테이션 절차**: HIS가 새 시크릿 PUT → 그 즉시 이후 콜백은 새 시크릿으로 서명되므로 HIS측 검증 시크릿도 동시 교체. (구 시크릿 병행 검증창이 필요하면 HIS측에서 신·구 2키 검증으로 흡수)

---

## 6. Wiki/매뉴얼 API (Phase 4)

### 6.1 GET /api/clinic/his/wiki/search

**진료 매뉴얼 검색**

#### Query Parameters

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| q | string | 검색어 |
| limit | number | 결과 수 (기본: 10) |

#### Response

```json
{
  "results": [
    {
      "id": "wiki-page-001",
      "title": "심폐소생술(CPR) 프로토콜",
      "excerpt": "1. 반응 확인 → 2. 119 신고 → 3. 가슴 압박 30회...",
      "path": "/protocols/emergency/cpr",
      "updatedAt": "2026-04-20T10:00:00Z",
      "author": "김간호"
    }
  ],
  "total": 3
}
```

---

### 6.2 GET /api/clinic/his/wiki/page/:pageId

**Wiki 페이지 상세** — HTML 또는 TipTap JSON 반환

#### Query Parameters

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| format | string | `html` (기본) 또는 `json` (TipTap) |

#### Response

```json
{
  "id": "wiki-page-001",
  "title": "심폐소생술(CPR) 프로토콜",
  "content": "<h1>CPR 프로토콜</h1><ol><li>반응 확인</li>...",
  "format": "html",
  "path": "/protocols/emergency/cpr",
  "author": { "userId": "user-002", "username": "김간호" },
  "updatedAt": "2026-04-20T10:00:00Z",
  "version": 3
}
```

---

### 6.3 POST /api/clinic/his/wiki/page

**Wiki 페이지 생성** — HIS에서 자동으로 진료 프로토콜 문서 생성

#### Request

```json
{
  "title": "당뇨병 관리 프로토콜",
  "content": "<h1>당뇨병 관리</h1><h2>1. 혈당 모니터링</h2><p>...",
  "format": "html",
  "parentPath": "/protocols/internal-medicine",
  "author": "user-uuid-001",
  "tags": ["당뇨", "내과", "프로토콜"]
}
```

#### Response

```json
{
  "ok": true,
  "pageId": "wiki-page-new-001",
  "path": "/protocols/internal-medicine/diabetes-management"
}
```

---

## 7. 날씨 API

Clinic에서 제공하는 날씨 정보를 HIS에서 활용할 수 있습니다.
OpenWeather API 기반, DB 캐시로 제공됩니다.

### 7.1 GET /api/weather

**현재 날씨 조회** — 사용자 등록 도시 기준 (미등록 시 서울)

> 인증: Clinic 세션 쿠키 또는 API Key + Hospital Code

#### Response

```json
{
  "city": "Seoul",
  "temp": 22.5,
  "feelsLike": 21.8,
  "humidity": 55,
  "description": "맑음",
  "icon": "01d",
  "windSpeed": 3.2,
  "updatedAt": "2026-05-08T09:00:00Z",
  "forecast": [
    { "date": "2026-05-07", "tempMin": 15, "tempMax": 24, "icon": "01d", "description": "맑음" },
    { "date": "2026-05-08", "tempMin": 16, "tempMax": 25, "icon": "02d", "description": "구름 조금" },
    { "date": "2026-05-09", "tempMin": 14, "tempMax": 22, "icon": "10d", "description": "비" }
  ],
  "displayPosition": "header",
  "units": "metric"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| city | string | 도시명 |
| temp | number | 현재 기온 (°C 또는 °F) |
| feelsLike | number | 체감 온도 |
| humidity | number | 습도 (%) |
| description | string | 날씨 설명 (한국어) |
| icon | string | OpenWeather 아이콘 코드 |
| windSpeed | number | 풍속 (m/s) |
| forecast | array | 3일 예보 (전날/오늘/내일) |
| units | string | `metric` (°C) 또는 `imperial` (°F) |

### 7.2 GET /api/weather/my-city

**사용자 설정 도시 날씨** — 개인 설정 도시 기준

> 인증: Clinic 세션 쿠키

#### Response

`GET /api/weather`와 동일 형식

### 7.3 아이콘 URL

OpenWeather 아이콘 이미지:
```
https://openweathermap.org/img/wn/{icon}@2x.png
```

예: `https://openweathermap.org/img/wn/01d@2x.png` (맑음)

---

## 8. Webhook API (Phase 5)

### 7.1 POST /api/clinic/his/webhooks

**Webhook 등록** — Clinic 이벤트를 HIS에 실시간 통보

#### Request

```json
{
  "url": "https://his.example.org/api/v1/webhooks/clinic",
  "events": [
    "wsign.approved",
    "wsign.rejected",
    "attendance.checkin",
    "attendance.checkout",
    "calendar.created",
    "calendar.updated",
    "member.joined",
    "member.left"
  ],
  "secret": "whsec_your_webhook_secret_here"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| url | string | ✅ | 콜백 URL (HTTPS 필수) |
| events | string[] | ✅ | 구독 이벤트 목록 |
| secret | string | ✅ | HMAC-SHA256 서명용 시크릿 |

#### Response

```json
{
  "ok": true,
  "webhookId": "wh-uuid-001",
  "events": ["wsign.approved", "wsign.rejected", "attendance.checkin", "attendance.checkout", "calendar.created", "calendar.updated", "member.joined", "member.left"]
}
```

---

### 7.2 GET /api/clinic/his/webhooks

**등록된 Webhook 목록**

#### Response

```json
{
  "webhooks": [
    {
      "id": "wh-uuid-001",
      "url": "https://his.example.org/api/v1/webhooks/clinic",
      "events": ["wsign.approved", "attendance.checkin"],
      "active": true,
      "lastTriggeredAt": "2026-05-07T10:30:00Z",
      "failureCount": 0,
      "createdAt": "2026-05-07T09:00:00Z"
    }
  ]
}
```

---

### 7.3 DELETE /api/clinic/his/webhooks/:webhookId

**Webhook 삭제**

#### Response

```json
{ "ok": true, "message": "Webhook이 삭제되었습니다" }
```

---

### 7.4 이벤트 목록 + 페이로드 규격

#### 이벤트 목록

| 이벤트 | 설명 | 트리거 시점 |
|--------|------|-----------|
| `wsign.approved` | 전자결재 승인 | 최종 결재자 승인 시 |
| `wsign.rejected` | 전자결재 반려 | 결재자 반려 시 |
| `wsign.withdrawn` | 전자결재 회수 | 기안자 회수 시 |
| `attendance.checkin` | 직원 출근 | 출근 버튼 클릭 시 |
| `attendance.checkout` | 직원 퇴근 | 퇴근 버튼 클릭 시 |
| `calendar.created` | 일정 생성 | 캘린더 일정 추가 시 |
| `calendar.updated` | 일정 변경 | 캘린더 일정 수정/삭제 시 |
| `member.joined` | 직원 가입 | 병원 코드로 새 직원 합류 시 |
| `member.left` | 직원 탈퇴 | 직원이 병원에서 탈퇴 시 |
| `checklist.completed` | 체크리스트 완료 | 출근 체크리스트 전체 완료 시 |

#### 페이로드 공통 형식

```json
{
  "event": "wsign.approved",
  "webhookId": "wh-uuid-001",
  "timestamp": "2026-05-07T10:30:00Z",
  "hospitalCode": "WRB-DEMO-M66M",
  "data": {
    /* 이벤트별 데이터 */
  },
  "signature": "sha256=a1b2c3d4..."
}
```

#### 서명 검증 (HIS 측)

```javascript
const crypto = require('crypto');
const expectedSig = 'sha256=' + crypto
  .createHmac('sha256', webhookSecret)
  .update(JSON.stringify(payload))
  .digest('hex');
const valid = crypto.timingSafeEqual(
  Buffer.from(signature),
  Buffer.from(expectedSig)
);
```

#### 이벤트별 data 필드

**wsign.approved / wsign.rejected**
```json
{
  "docId": "wsign-doc-001",
  "title": "의료소모품 구매 요청",
  "drafter": { "userId": "user-003", "username": "박간호" },
  "approvedBy": { "userId": "user-001", "username": "김과장" },
  "status": "approved",
  "completedAt": "2026-05-07T10:30:00Z"
}
```

**attendance.checkin / checkout**
```json
{
  "userId": "user-001",
  "username": "김의사",
  "action": "checkin",
  "time": "2026-05-07T08:15:00Z",
  "department": "내과",
  "hisRole": "Doctor"
}
```

**member.joined**
```json
{
  "userId": "user-new-001",
  "username": "신입간호",
  "email": "new@hospital.example",
  "role": "REGULAR",
  "joinedAt": "2026-05-07T09:00:00Z"
}
```

---

#### 재시도 정책

- 실패 시 **3회 재시도** (10초, 60초, 300초 간격)
- 5회 연속 실패 시 자동 비활성화 (`active: false`)
- 비활성화 시 Clinic 관리자에게 알림 발송

---

## 전체 API 요약 (Phase 2~5)

| Phase | 영역 | API 수 |
|:-----:|------|:------:|
| 2 | 알림 (notify/urgent/history) | 3 |
| 2 | 채널 메시지 (channels/message/handoff) | 3 |
| 3 | 캘린더 (sync/events/duty/duty-update) | 4 |
| 3 | 근태 (attendance/leave) | 2 |
| 4 | 전자결재 (wsign/request, wsign/status) | 2 |
| 4 | Wiki (search/page/create) | 3 |
| 5 | Webhook (create/list/delete) | 3 |
| — | 병원 정보/설정 | 3 |
| — | 날씨 (weather/my-city) | 2 |
| **합계** | | **25** |
