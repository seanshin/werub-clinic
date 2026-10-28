# Clinic ↔ HIS 연동 API 기획서

> Created: 2026-05-06
> Status: Draft

## 개요

WeRU.B Clinic(clinic.example.org)과 Hospital RUN HIS(his.example.org) 간의 연동 API.
Clinic은 **그룹웨어**(채널/캘린더/Wiki/전자결재/근태), HIS는 **진료 시스템**(EMR/OCS/약국/검사/수납).
두 시스템이 사용자 인증, 데이터, 알림을 공유하기 위한 API 명세.

## 아키텍처

```
┌──────────────────────┐        ┌──────────────────────┐
│  WeRU.B Clinic       │  API   │  Hospital RUN HIS    │
│  (clinic.example.org) │◄──────►│  (his.example.org)    │
│                      │        │                      │
│  그룹웨어             │        │  진료 시스템           │
│  - 채널/채팅          │        │  - EMR/OCS           │
│  - 캘린더/근무표      │        │  - 약국/검사/영상      │
│  - Wiki/전자결재      │        │  - 수납/청구           │
│  - 근태/연차          │        │  - 환자관리            │
│  - AI Knowledge      │        │  - 인사/자재           │
└──────┬───────────────┘        └──────┬───────────────┘
       │                               │
       └───────────┬───────────────────┘
                   │
            ┌──────┴──────┐
            │  공유 Auth   │
            │  공유 DB     │
            │  (PostgreSQL)│
            └─────────────┘
```

## 인증 연동

### 1. SSO (Single Sign-On)

Clinic에서 로그인한 사용자가 HIS에 재로그인 없이 접근하도록 한다.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| SSO 토큰 발급 | POST | `/api/clinic/sso/token` | Clinic 세션 → HIS용 일회성 SSO 토큰 발급 |
| SSO 토큰 검증 | POST | `/api/his/sso/verify` | HIS가 토큰 검증 → 세션 생성 |
| 세션 동기화 | GET | `/api/clinic/sso/session` | 현재 세션 상태 확인 |
| SSO 로그아웃 | POST | `/api/clinic/sso/logout` | 양쪽 세션 동시 종료 |

#### SSO 토큰 발급 — `POST /api/clinic/sso/token`

```json
// Request (Clinic → Clinic API)
{
  "targetService": "his",
  "hospitalCode": "WRB-DEMO-M66M"
}

// Response
{
  "token": "CHANGE_ME",       // 일회성, 30초 TTL
  "redirectUrl": "https://his.example.org/sso?token=CHANGE_ME"
}
```

#### SSO 토큰 검증 — `POST /api/his/sso/verify`

```json
// Request (HIS → Clinic API)
{
  "token": "CHANGE_ME",
  "service": "his"
}

// Response
{
  "valid": true,
  "user": {
    "id": "user-uuid",
    "email": "doctor@hospital.example",
    "username": "김의사",
    "role": "MANAGER",           // Clinic 역할
    "hisRole": "Doctor",         // HIS 매핑 역할
    "hospitalId": "cafe-uuid",
    "hospitalName": "위루비병원",
    "hospitalCode": "WRB-DEMO-M66M"
  }
}
```

### 2. 역할 매핑

| Clinic 역할 | HIS 역할 | 설명 |
|------------|---------|------|
| OWNER | Admin | 병원 전체 관리자 |
| MANAGER | Doctor / Nurse | 의료진 (부서별 분기) |
| REGULAR | Nurse / Pharmacist / Lab Tech | 직원 (직종별 분기) |

#### 역할 매핑 설정 — `GET/PUT /api/clinic/his/role-mapping`

```json
// GET Response
{
  "mappings": [
    { "userId": "user-1", "clinicRole": "MANAGER", "hisRole": "Doctor", "department": "내과" },
    { "userId": "user-2", "clinicRole": "REGULAR", "hisRole": "Nurse", "department": "외과" },
    { "userId": "user-3", "clinicRole": "REGULAR", "hisRole": "Pharmacist", "department": null }
  ]
}

// PUT Request (역할 매핑 업데이트)
{
  "userId": "user-1",
  "hisRole": "Doctor",
  "department": "내과",
  "specialties": ["일반내과", "소화기내과"]
}
```

---

## 사용자 관리 API

HIS에서 Clinic의 사용자 정보를 조회/수정한다.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| 직원 목록 | GET | `/api/clinic/his/staff` | 병원 소속 직원 전체 목록 |
| 직원 상세 | GET | `/api/clinic/his/staff/:userId` | 직원 프로필 + 역할 + 부서 |
| 직원 정보 수정 | PATCH | `/api/clinic/his/staff/:userId` | 직종/부서/면허번호 등 HIS 전용 필드 |
| 직원 상태 | GET | `/api/clinic/his/staff/:userId/status` | 출근/퇴근/외근/휴가 상태 |
| 온라인 직원 | GET | `/api/clinic/his/staff/online` | 현재 접속 중인 직원 목록 |

#### 직원 목록 — `GET /api/clinic/his/staff`

```json
// Response
{
  "staff": [
    {
      "id": "user-uuid",
      "username": "김의사",
      "email": "doctor@hospital.example",
      "profileImage": "https://...",
      "clinicRole": "MANAGER",
      "hisRole": "Doctor",
      "department": "내과",
      "licenseNumber": "의사-12345",
      "specialties": ["일반내과"],
      "workStatus": "office",        // office|remote|leave|off
      "lastActive": "2026-05-06T09:30:00Z"
    }
  ],
  "total": 25
}
```

#### 직원 정보 수정 — `PATCH /api/clinic/his/staff/:userId`

```json
// Request (HIS → Clinic)
{
  "hisRole": "Doctor",
  "department": "내과",
  "licenseNumber": "의사-12345",
  "specialties": ["일반내과", "소화기내과"],
  "npiNumber": null
}
```

---

## 일정/캘린더 연동

HIS의 진료 일정을 Clinic 캘린더와 동기화한다.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| 일정 동기화 | POST | `/api/clinic/his/calendar/sync` | HIS 일정 → Clinic 캘린더 반영 |
| 일정 조회 | GET | `/api/clinic/his/calendar/events` | Clinic 캘린더 일정 조회 |
| 당직표 조회 | GET | `/api/clinic/his/schedule/duty` | 당직/교대 근무표 |
| 당직표 수정 | PUT | `/api/clinic/his/schedule/duty` | 당직표 업데이트 |
| 수술 일정 | POST | `/api/clinic/his/calendar/surgery` | 수술 일정 등록 → 캘린더 반영 |

#### 일정 동기화 — `POST /api/clinic/his/calendar/sync`

```json
// Request (HIS → Clinic)
{
  "events": [
    {
      "externalId": "his-surgery-001",
      "title": "이OO 환자 담낭절제술",
      "type": "surgery",              // surgery|appointment|duty|meeting
      "startTime": "2026-05-07T09:00:00+09:00",
      "endTime": "2026-05-07T12:00:00+09:00",
      "assignees": ["user-1", "user-2"],
      "location": "수술실 2",
      "priority": "high",
      "metadata": {
        "patientId": "patient-001",
        "procedureCode": "47562"
      }
    }
  ],
  "deleteIds": ["his-surgery-old-001"]
}

// Response
{
  "synced": 1,
  "deleted": 1,
  "errors": []
}
```

---

## 알림 연동

HIS 이벤트를 Clinic 알림 시스템으로 전달한다.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| 알림 발송 | POST | `/api/clinic/his/notify` | HIS → Clinic 알림 전송 |
| 긴급 알림 | POST | `/api/clinic/his/notify/urgent` | 긴급 알림 (채널 메시지 + 푸시) |
| 알림 조회 | GET | `/api/clinic/his/notify/history` | 발송된 알림 이력 |

#### 알림 발송 — `POST /api/clinic/his/notify`

```json
// Request (HIS → Clinic)
{
  "type": "his_alert",
  "recipients": ["user-1"],          // 또는 "all", "department:내과"
  "title": "검사 결과 확인",
  "message": "이OO 환자 혈액검사 결과가 도착했습니다. 이상 수치: WBC 12,000",
  "priority": "normal",              // normal|high|urgent
  "link": "https://his.example.org/lab/results/lab-001",
  "category": "lab_result",          // lab_result|prescription|admission|emergency|surgery
  "metadata": {
    "patientId": "patient-001",
    "resultId": "lab-result-001"
  }
}
```

#### 긴급 알림 — `POST /api/clinic/his/notify/urgent`

```json
// 채널 메시지 + 알림 + 푸시 동시 발송
{
  "channel": "emergency",            // 자동으로 해당 채널에 메시지 전송
  "title": "🚨 응급 환자 입원",
  "message": "KTAS 1등급 환자 입원. 심정지, CPR 진행 중. 담당: 김의사",
  "assignees": ["user-1", "user-2"]
}
```

---

## 채널 메시지 연동

HIS 이벤트를 Clinic 채널(CaféBoard)에 자동 게시한다.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| 채널 메시지 전송 | POST | `/api/clinic/his/channel/message` | HIS → 특정 채널에 메시지 전송 |
| 채널 목록 | GET | `/api/clinic/his/channels` | 병원 채널 목록 조회 |
| 인수인계 전송 | POST | `/api/clinic/his/channel/handoff` | 인수인계 노트 채널 전송 |

#### 채널 메시지 — `POST /api/clinic/his/channel/message`

```json
{
  "channelName": "내과-공지",         // 채널명 또는 channelId
  "content": "**[검사 결과 알림]**\n이OO 환자 CT 판독 결과:\n- 소견: 정상 소견\n- 판독의: 박영상",
  "sender": "system",                // system 또는 userId
  "attachments": [],
  "threadId": null                   // 스레드 답글 시 지정
}
```

---

## 전자결재 연동

HIS의 의료 문서를 Clinic 전자결재(W.Sign)로 전달한다.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| 결재 요청 | POST | `/api/clinic/his/wsign/request` | HIS 문서 → W.Sign 기안 생성 |
| 결재 상태 | GET | `/api/clinic/his/wsign/status/:docId` | 결재 진행 상태 조회 |
| 결재 완료 콜백 | (Webhook) | HIS 측 등록 | 결재 완료 시 HIS에 통보 |

#### 결재 요청 — `POST /api/clinic/his/wsign/request`

```json
{
  "templateId": "medical-purchase",   // 결재 양식
  "title": "의료소모품 구매 요청 — 주사기 1,000개",
  "drafter": "user-3",               // 기안자
  "approvers": ["user-1"],           // 결재자
  "content": {
    "items": [
      { "name": "일회용 주사기 3cc", "quantity": 1000, "unitPrice": 150, "total": 150000 }
    ],
    "totalAmount": 150000,
    "reason": "재고 부족 — 안전재고 이하"
  },
  "callbackUrl": "https://his.example.org/api/v1/webhooks/wsign"
}
```

---

## Wiki/매뉴얼 연동

HIS의 진료 프로토콜을 Clinic Wiki(ShareSpace)에서 관리한다.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| 매뉴얼 조회 | GET | `/api/clinic/his/wiki/search` | Wiki 문서 검색 (프로토콜/가이드라인) |
| 매뉴얼 상세 | GET | `/api/clinic/his/wiki/page/:pageId` | Wiki 페이지 HTML 반환 |
| 매뉴얼 생성 | POST | `/api/clinic/his/wiki/page` | HIS에서 Wiki 문서 자동 생성 |

#### 매뉴얼 검색 — `GET /api/clinic/his/wiki/search?q=심폐소생술`

```json
{
  "results": [
    {
      "id": "wiki-page-001",
      "title": "심폐소생술(CPR) 프로토콜",
      "excerpt": "1. 반응 확인 → 2. 119 신고 → 3. 가슴 압박 30회...",
      "updatedAt": "2026-04-20T10:00:00Z",
      "author": "김간호",
      "path": "/protocols/emergency/cpr"
    }
  ]
}
```

---

## 근태/인사 연동

HIS 인사(HR) 모듈과 Clinic 근태 시스템 동기화.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| 근태 현황 | GET | `/api/clinic/his/attendance` | 오늘 전체 직원 출퇴근 현황 |
| 근무표 조회 | GET | `/api/clinic/his/schedule` | 주간/월간 근무 스케줄 |
| 근무표 수정 | PUT | `/api/clinic/his/schedule` | 당직/교대 스케줄 변경 |
| 연차 현황 | GET | `/api/clinic/his/leave` | 직원별 잔여 연차 |
| 연차 신청 | POST | `/api/clinic/his/leave/request` | HIS에서 연차 신청 → W.Sign 연동 |

---

## 병원 설정 API

HIS에서 병원 기본 정보와 설정을 조회/수정한다.

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| 병원 정보 | GET | `/api/clinic/his/hospital` | 병원 기본 정보 (이름/주소/코드/진료과) |
| 병원 설정 | GET/PUT | `/api/clinic/his/hospital/settings` | HIS 연동 설정 (기능 on/off) |
| 진료과 목록 | GET | `/api/clinic/his/departments` | 등록된 진료과 목록 |
| 진료과 관리 | POST/PUT/DELETE | `/api/clinic/his/departments/:id` | 진료과 CRUD |

#### 병원 정보 — `GET /api/clinic/his/hospital`

```json
{
  "id": "cafe-uuid",
  "name": "위루비병원",
  "code": "WRB-DEMO-M66M",
  "type": "hospital",
  "businessNumber": "000-00-00000",
  "representative": "홍원장",
  "specialty": "종합병원",
  "address": null,
  "phone": "010-9972-1760",
  "departments": ["내과", "외과", "정형외과", "응급의학과"],
  "staffCount": 25,
  "hisEnabled": true,
  "features": {
    "board": true, "calendar": true, "sharespace": true,
    "attendance": true, "wsign": true, "organization": true
  }
}
```

---

## 인증/보안

### API 키 인증

모든 HIS → Clinic API 호출은 **API 키 + 병원 코드**로 인증한다.

```
Authorization: Bearer his_api_key_xxx
X-Hospital-Code: WRB-DEMO-M66M
```

### API 키 관리

| API | Method | 경로 | 설명 |
|-----|--------|------|------|
| API 키 발급 | POST | `/api/clinic/his/api-keys` | HIS 연동용 API 키 발급 |
| API 키 목록 | GET | `/api/clinic/his/api-keys` | 발급된 키 목록 |
| API 키 폐기 | DELETE | `/api/clinic/his/api-keys/:keyId` | 키 비활성화 |

### 보안 요구사항

- 모든 API는 HTTPS 필수
- API 키는 AES-256으로 암호화 저장
- PHI(개인건강정보) 접근 시 감사 로그 자동 기록
- Rate Limit: 1,000 req/min (병원당)
- IP 화이트리스트 설정 가능

---

## Webhook (Clinic → HIS 콜백)

Clinic 이벤트를 HIS에 실시간 통보한다.

| 이벤트 | 설명 |
|--------|------|
| `wsign.approved` | 전자결재 승인 완료 |
| `wsign.rejected` | 전자결재 반려 |
| `calendar.created` | 캘린더 일정 생성 |
| `calendar.updated` | 캘린더 일정 변경 |
| `attendance.checkin` | 직원 출근 |
| `attendance.checkout` | 직원 퇴근 |
| `member.joined` | 새 직원 가입 |
| `member.left` | 직원 탈퇴 |

#### Webhook 등록 — `POST /api/clinic/his/webhooks`

```json
{
  "url": "https://his.example.org/api/v1/webhooks/clinic",
  "events": ["wsign.approved", "wsign.rejected", "attendance.checkin"],
  "secret": "webhook_secret_xxx"
}
```

#### Webhook 페이로드

```json
{
  "event": "wsign.approved",
  "timestamp": "2026-05-06T10:30:00Z",
  "hospitalCode": "WRB-DEMO-M66M",
  "data": {
    "docId": "wsign-doc-001",
    "title": "의료소모품 구매 요청",
    "approvedBy": "user-1",
    "approvedAt": "2026-05-06T10:30:00Z"
  },
  "signature": "hmac-sha256-xxx"
}
```

---

## API 요약

| 영역 | API 수 | 방향 |
|------|:------:|------|
| SSO 인증 | 4 | 양방향 |
| 사용자/역할 | 5 | HIS → Clinic |
| 캘린더/일정 | 5 | HIS → Clinic |
| 알림 | 3 | HIS → Clinic |
| 채널 메시지 | 3 | HIS → Clinic |
| 전자결재 | 3 | HIS → Clinic |
| Wiki/매뉴얼 | 3 | HIS → Clinic |
| 근태/인사 | 5 | 양방향 |
| 병원 설정 | 4 | 양방향 |
| API 키 | 3 | Clinic 내부 |
| Webhook | 2 | Clinic → HIS |
| **합계** | **40** | |

## 구현 우선순위

| Phase | API | 설명 |
|:-----:|-----|------|
| 1 | SSO + 역할 매핑 + API 키 | 인증 기반 (필수) |
| 2 | 알림 + 채널 메시지 | 실시간 소통 연동 |
| 3 | 캘린더 + 근태 | 일정/근무 동기화 |
| 4 | 전자결재 + Wiki | 문서 연동 |
| 5 | Webhook | 실시간 콜백 |
