# W.Clinic 워크그룹 확장 — HIS 연동 API 명세서

작성일: 2026-05-18
작성: WeRU.B Clinic 팀
대상: HIS 개발팀
버전: v1.0
참조: WeRUB_Clinic_HIS_연동_통합문서_v1.1.0.md
연락: contact@example.org / 070-7799-2772

---

## 1. 개요

W.Clinic(clinic.example.org)을 병원 실무자 워크그룹으로 확장합니다.
의사, 간호사, 원무/행정 직군별로 필요한 핵심 업무 기능을 제공하며,
**모든 의료 데이터는 HIS에서 제공**하고, Clinic은 **시각화/UX/알림/협업**을 담당합니다.

### 목표
- ✅ 직종별 업무 흐름 (의사/진료, 간호사/환자관리, 원무/수납, 행정/보고)
- ✅ HIS 데이터 실시간 동기화 (EMR/OCS/약국/검사/수납)
- ✅ 원활한 협업 (채널/캘린더/Wiki를 통한 팀 소통)
- ✅ 자동화 알림 (진료 완료/약품 준비/수납 미납 등 실시간 푸시)

### 구조

Clinic ↔ HIS 간 API 연동
- Clinic: 그룹웨어 UI/UX (대시보드, 채널/캘린더, 직종별 뷰, 알림)
- HIS: 진료 시스템 (EMR/OCS/약국/검사, 환자 데이터, 처방/결과, 수납/매출)
- 공유 인프라: PostgreSQL DB, 공유 Auth, 공유 토큰

---

## 2. 인증 API

### 2.1 SSO 토큰 발급

**POST /api/clinic/sso/token**

Request:
```
Content-Type: application/json
Authorization: Bearer [clinic_access_token]

{
  "targetService": "his",
  "hospitalCode": "WRB-DEMO-M66M"
}
```

Response:
```json
{
  "token": "CHANGE_ME",
  "expiresIn": 30,
  "redirectUrl": "https://his.example.org/sso?token=CHANGE_ME"
}
```

특징: TTL 30초 (일회성), Base64 인코딩, hospitalCode 검증 필수

### 2.2 SSO 토큰 검증

**POST /api/his/sso/verify**

Request:
```
Content-Type: application/json
X-HIS-Secret: [his_service_secret]

{
  "token": "CHANGE_ME",
  "service": "his",
  "hospitalCode": "WRB-DEMO-M66M"
}
```

Response:
```json
{
  "valid": true,
  "userId": "user-uuid-123",
  "user": {
    "id": "user-uuid-123",
    "email": "doctor@hospital.example",
    "username": "김의사",
    "clinicRole": "MANAGER",
    "hisRole": "Doctor",
    "department": "내과"
  }
}
```

---

## 3. 사용자 API

### 3.1 직원 조회

**GET /api/clinic/his/staff**

```
Authorization: Bearer [token]
Query: department=내과&status=active&limit=50&offset=0
```

Response:
```json
{
  "data": [
    {
      "id": "user-uuid-1",
      "username": "김의사",
      "email": "kim.doctor@hospital.example",
      "hisRole": "Doctor",
      "department": "내과",
      "status": "active",
      "onlineStatus": "online"
    }
  ],
  "total": 245
}
```

### 3.2 의사 진료 일정

**GET /api/clinic/his/doctor/schedule**

```
Authorization: Bearer [token]
Query: userId=user-uuid-1&date=2026-05-18
```

Response:
```json
{
  "schedule": [
    {
      "appointmentId": "apt-1",
      "patientName": "이환자",
      "time": "2026-05-18T10:00:00Z",
      "chief": "복통",
      "status": "waiting"
    }
  ],
  "totalAppointments": 15,
  "completedAppointments": 5
}
```

### 3.3 간호사 환자 관리

**GET /api/clinic/his/nurse/patients**

```
Authorization: Bearer [token]
Query: assignmentId=asn-1
```

Response:
```json
{
  "data": [
    {
      "patientId": "pat-1",
      "patientName": "이환자",
      "roomNo": "308호",
      "diagnosis": "폐렴",
      "vitals": {
        "bp": "120/80",
        "temp": "36.5",
        "lastRecorded": "2026-05-18T14:00:00Z"
      }
    }
  ],
  "total": 12
}
```

### 3.4 약사 미조제 처방

**GET /api/clinic/his/pharmacy/pending-prescriptions**

```
Authorization: Bearer [token]
```

Response:
```json
{
  "data": [
    {
      "prescriptionId": "rx-1",
      "doctor": "김의사",
      "patient": "이환자",
      "medications": [
        {
          "name": "항생제",
          "dosage": "500mg",
          "quantity": 30
        }
      ],
      "issuedTime": "2026-05-18T10:30:00Z"
    }
  ],
  "total": 24
}
```

### 3.5 원무 수납 미납

**GET /api/clinic/his/billing/unpaid**

```
Authorization: Bearer [token]
Query: limit=50
```

Response:
```json
{
  "data": [
    {
      "billId": "bill-1",
      "patientName": "이환자",
      "visitDate": "2026-05-17",
      "amount": 150000,
      "outstanding": 150000,
      "dueDate": "2026-05-25",
      "status": "unpaid"
    }
  ],
  "total": 45,
  "outstandingTotal": 2250000
}
```

---

## 4. 상태 관리 API

### 4.1 출근/퇴근 체크인

**POST /api/clinic/his/attendance/check-in**

```json
{
  "userId": "user-uuid-1",
  "checkInTime": "2026-05-18T08:50:00Z",
  "location": "main_entrance"
}
```

### 4.2 직원 상태 변경

**PUT /api/clinic/his/staff/:userId/status**

```json
{
  "status": "away",
  "reason": "회의중",
  "endTime": "2026-05-18T15:00:00Z"
}
```

### 4.3 처방 조제 완료

**PUT /api/clinic/his/pharmacy/prescriptions/:prescriptionId/dispense**

```json
{
  "dispensedTime": "2026-05-18T15:00:00Z",
  "dispensedBy": "user-uuid-3"
}
```

### 4.4 수납 등록

**POST /api/clinic/his/billing/payment**

```json
{
  "billId": "bill-1",
  "paymentMethod": "card",
  "amount": 150000,
  "paidAt": "2026-05-18T15:30:00Z"
}
```

---

## 5. Webhook (HIS → Clinic)

### 5.1 이벤트 목록

- appointment_created: 진료 예약
- prescription_issued: 처방 발행
- prescription_ready: 약품 준비 완료
- lab_result_ready: 검사 결과
- payment_required: 수납 미납
- admission_created: 입원
- discharge_scheduled: 퇴원 예정

### 5.2 Webhook 형식

**POST /api/clinic/his/webhooks/notify**

Request:
```
X-HIS-Signature: [hmac_sha256]
Content-Type: application/json

{
  "eventType": "prescription_ready",
  "title": "약품 준비 완료",
  "message": "환자 '이환자'의 처방약이 준비되었습니다.",
  "targetUserId": "user-uuid-3",
  "targetChannel": "ch-dept-1",
  "metadata": {
    "prescriptionId": "rx-1",
    "patientName": "이환자"
  }
}
```

Response:
```json
{
  "success": true,
  "messageId": "msg-1",
  "channel": "ch-dept-1"
}
```

---

## 6. 협업 기능

### 6.1 채널 (CaféBoard)

**GET /api/clinic/channels**

Query: department=내과
Authorization: Bearer [token]

### 6.2 캘린더

**GET /api/clinic/calendars**

Query: department=내과&date=2026-05-18
Authorization: Bearer [token]

### 6.3 Wiki

**GET /api/clinic/wiki**

Query: department=내과
Authorization: Bearer [token]

---

## 7. 오류 코드

| 코드 | HTTP | 설명 |
|-----|------|------|
| INVALID_TOKEN | 401 | 토큰 만료/무효 |
| INSUFFICIENT_PERMISSION | 403 | 권한 부족 |
| RESOURCE_NOT_FOUND | 404 | 데이터 없음 |
| VALIDATION_ERROR | 400 | 입력값 오류 |
| RATE_LIMIT_EXCEEDED | 429 | 요청 한도 초과 |
| INTERNAL_SERVER_ERROR | 500 | 서버 오류 |

---

## 8. 보안

### 8.1 API 키 발급

**POST /api/clinic/api-keys**

```json
{
  "name": "his-integration",
  "scopes": ["staff.read", "staff.write", "schedule.read"]
}
```

### 8.2 헤더 인증

- JWT: Authorization: Bearer [jwt_token]
- API Key: X-API-Key: [api_key], X-API-Secret: [api_secret]
- Webhook: X-HIS-Signature: [hmac_sha256_hex], X-HIS-Timestamp: [unix_timestamp]

### 8.3 재시도 정책

- 1차: 즉시
- 2차: 5초 후
- 3차: 30초 후
- 4차: 5분 후

---

## 9. 구현 체크리스트

### Phase 1 (필수)
- [ ] SSO 토큰 발급/검증
- [ ] 직원 조회 API
- [ ] 출근/퇴근 체크인
- [ ] 역할 매핑

### Phase 2
- [ ] 의사 진료 일정
- [ ] 간호사 환자 관리
- [ ] 처방 조회/수정

### Phase 3
- [ ] 약사 처방 관리
- [ ] 원무 수납 관리
- [ ] 통계/매출

### Phase 4
- [ ] Webhook 구현
- [ ] 실시간 알림

### Phase 5
- [ ] 성능 최적화
- [ ] 보안 감사
- [ ] 배포

---

## 10. 연락처

- Clinic 개발팀: contact@example.org
- 기술 문의: 070-7799-2772
- Slack: #clinic-his-integration
- GitHub: WeRU.B/clinic-his-integration

---

## 참고 문서

- WeRUB_Clinic_HIS_연동_통합문서_v1.1.0.md (기술 상세 명세)
- /packages/hospital-web/ (Clinic 구현 코드)
