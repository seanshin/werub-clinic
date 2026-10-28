# WeRU.B Clinic ↔ HIS 연동 API 명세서

> Version: 1.0.0
> Date: 2026-05-06
> Base URL: `https://example.org`

---

## 1. 개요

이 문서는 **WeRU.B Clinic**(그룹웨어)과 **Hospital RUN HIS**(병원정보시스템) 간의 연동 API를 정의합니다.

### 시스템 구성

| 시스템 | 도메인 | 역할 |
|--------|--------|------|
| WeRU.B Clinic | clinic.example.org | 그룹웨어 (채널/캘린더/Wiki/전자결재/근태) |
| Hospital RUN HIS | his.example.org | 진료 시스템 (EMR/OCS/약국/검사/수납) |

### 데이터 흐름

```
┌──────────────┐                     ┌──────────────┐
│  HIS Server  │ ── API Key 인증 ──► │  Clinic API  │
│              │ ◄── Webhook 콜백 ── │              │
└──────────────┘                     └──────────────┘
       │                                    │
       └──── SSO (토큰 교환) ──────────────┘
```

---

## 2. 인증

### 2.1 API Key 인증

모든 HIS → Clinic API 호출에는 **API 키**와 **병원 코드**가 필요합니다.

#### 헤더

```
Authorization: Bearer his_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X-Hospital-Code: WRB-XXXX-XXXX
Content-Type: application/json
```

#### API 키 발급

Clinic 대시보드 > 병원 워크그룹 관리 > 병원 코드 탭에서 발급하거나, API로 발급합니다.

> ⚠️ API 키는 발급 시 **1회만** 표시됩니다. 안전한 곳에 보관하세요.

#### 인증 실패 응답

```json
{
  "error": "유효하지 않은 API 키입니다",
  "statusCode": 401
}
```

```json
{
  "error": "병원 코드와 API 키가 일치하지 않습니다",
  "statusCode": 403
}
```

### 2.2 Rate Limit

- 병원당 **1,000 req/min**
- 초과 시 `429 Too Many Requests` 응답

---

## 3. SSO (Single Sign-On)

Clinic에서 로그인한 사용자가 HIS에 **재로그인 없이** 접근하는 플로우입니다.

### 3.1 SSO 플로우

```
1. 사용자가 Clinic에서 "HIS" 버튼 클릭
2. Clinic → POST /api/clinic/sso/token → SSO 토큰 발급
3. 사용자 브라우저 → HIS /sso?token=sso_xxx 리다이렉트
4. HIS 서버 → POST /api/clinic/sso/verify → 토큰 검증 + 사용자 정보 수신
5. HIS 서버 → 자체 세션 생성 → 대시보드 표시
```

### 3.2 POST /api/clinic/sso/token

**SSO 토큰 발급** — Clinic 사용자가 HIS로 이동할 때 호출

> 인증: Clinic 세션 쿠키 (HIS가 아닌 Clinic 프론트엔드에서 호출)

#### Request

```json
{
  "targetService": "his"
}
```

#### Response

```json
{
  "token": "CHANGE_ME",
  "redirectUrl": "https://his.example.org/sso?token=CHANGE_ME",
  "expiresAt": "2026-05-06T09:30:30Z",
  "targetService": "his"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| token | string | 일회성 SSO 토큰 |
| redirectUrl | string | HIS 리다이렉트 URL (토큰 포함) |
| expiresAt | ISO8601 | 만료 시각 (**30초 TTL**) |

---

### 3.3 POST /api/clinic/sso/verify

**SSO 토큰 검증** — HIS 서버가 토큰을 검증하고 사용자 정보를 받아옵니다.

> 인증: 없음 (토큰 자체가 인증) — 단, 프로덕션에서는 서버 간 통신만 허용 권장

#### Request

```json
{
  "token": "CHANGE_ME"
}
```

#### Response (성공)

```json
{
  "valid": true,
  "user": {
    "id": "09c5ecb8-0f83-4499-a40b-ce2e09cbd624",
    "email": "doctor@hospital.example",
    "username": "김의사",
    "profileImage": "https://cdn.werub.com/profiles/xxx.jpg",
    "role": "MANAGER",
    "hisRole": "Doctor",
    "department": "내과",
    "licenseNumber": "의사-12345",
    "specialties": ["일반내과", "소화기내과"],
    "hospitalId": "cafe-uuid-xxx",
    "hospitalName": "위루비병원",
    "hospitalCode": "WRB-DEMO-M66M",
    "hospitalType": "hospital"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| user.id | string | Clinic 사용자 UUID |
| user.role | string | Clinic 역할 (OWNER/MANAGER/REGULAR) |
| user.hisRole | string | HIS 매핑 역할 (아래 참조) |
| user.department | string? | 소속 진료과 |
| user.licenseNumber | string? | 면허번호 |
| user.hospitalCode | string | 병원 식별 코드 |

#### Response (실패)

```json
{
  "error": "이미 사용된 SSO 토큰입니다",
  "statusCode": 401
}
```

> ⚠️ SSO 토큰은 **일회성**이며 **30초** 후 만료됩니다.

---

### 3.4 GET /api/clinic/sso/session

**세션 상태 확인** — 현재 Clinic 로그인 여부와 병원 소속 확인

> 인증: Clinic 세션 쿠키

#### Response

```json
{
  "authenticated": true,
  "user": { "id": "user-uuid", "role": "ADMIN" },
  "hospital": {
    "id": "cafe-uuid",
    "name": "위루비병원",
    "type": "hospital",
    "code": "WRB-DEMO-M66M",
    "memberRole": "MANAGER"
  }
}
```

---

### 3.5 POST /api/clinic/sso/logout

**SSO 로그아웃** — Clinic 세션 종료 (쿠키 삭제)

> HIS 측에서도 자체 세션을 삭제해야 합니다.

#### Response

```json
{ "ok": true, "message": "로그아웃되었습니다" }
```

---

## 4. 역할 매핑

Clinic 역할과 HIS 역할 간의 매핑을 관리합니다.

### 역할 체계

| Clinic 역할 | HIS 역할 | 설명 |
|------------|---------|------|
| OWNER | Admin | 병원 전체 관리자 |
| MANAGER | Doctor 또는 Nurse | 의료진 (수동 매핑) |
| REGULAR | Nurse / Pharmacist / LabTech / Staff | 직원 (수동 매핑) |

### HIS 역할 목록

| hisRole | 설명 | 권한 |
|---------|------|------|
| `Admin` | 시스템 관리자 | 전체 접근 |
| `Doctor` | 의사 | 진료/처방/오더 |
| `Nurse` | 간호사 | 간호기록/투약확인 |
| `Pharmacist` | 약사 | 조제/DUR |
| `LabTech` | 검사기사 | 검사결과입력 |
| `Staff` | 일반직원 | 기본 접근 |

---

### 4.1 GET /api/clinic/his/role-mapping

**역할 매핑 목록 조회**

> 인증: API Key + Hospital Code

#### Response

```json
{
  "mappings": [
    {
      "user_id": "user-uuid-001",
      "username": "김의사",
      "email": "doctor@hospital.example",
      "clinic_role": "MANAGER",
      "his_role": "Doctor",
      "department": "내과",
      "license_number": "의사-12345",
      "specialties": ["일반내과", "소화기내과"]
    },
    {
      "user_id": "user-uuid-002",
      "username": "이간호",
      "email": "nurse@hospital.example",
      "clinic_role": "REGULAR",
      "his_role": "Nurse",
      "department": "외과",
      "license_number": "간호-67890",
      "specialties": []
    }
  ]
}
```

---

### 4.2 PUT /api/clinic/his/role-mapping

**역할 매핑 생성/수정** (UPSERT)

> 인증: API Key + Hospital Code

#### Request

```json
{
  "userId": "user-uuid-001",
  "hisRole": "Doctor",
  "department": "내과",
  "licenseNumber": "의사-12345",
  "specialties": ["일반내과", "소화기내과"],
  "metadata": {
    "npiNumber": null,
    "boardCertified": true
  }
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| userId | string | ✅ | Clinic 사용자 ID |
| hisRole | string | ✅ | HIS 역할 (Admin/Doctor/Nurse/Pharmacist/LabTech/Staff) |
| department | string | | 소속 진료과 |
| licenseNumber | string | | 면허번호 |
| specialties | string[] | | 전문 분야 목록 |
| metadata | object | | 추가 데이터 (자유 형식) |

#### Response

```json
{ "ok": true, "message": "역할 매핑 저장 완료: Doctor" }
```

---

## 5. 직원 관리

### 5.1 GET /api/clinic/his/staff

**병원 직원 전체 목록**

> 인증: API Key + Hospital Code

#### Response

```json
{
  "staff": [
    {
      "id": "user-uuid-001",
      "username": "김의사",
      "email": "doctor@hospital.example",
      "profileImage": "https://cdn.werub.com/profiles/xxx.jpg",
      "clinicRole": "MANAGER",
      "hisRole": "Doctor",
      "department": "내과",
      "licenseNumber": "의사-12345",
      "specialties": ["일반내과"],
      "joinedAt": "2026-05-06T09:00:00Z"
    }
  ],
  "total": 25
}
```

---

### 5.2 GET /api/clinic/his/staff/:userId

**직원 상세 정보**

> 인증: API Key + Hospital Code

#### Response

```json
{
  "id": "user-uuid-001",
  "username": "김의사",
  "email": "doctor@hospital.example",
  "profileImage": "https://cdn.werub.com/profiles/xxx.jpg",
  "clinicRole": "MANAGER",
  "hisRole": "Doctor",
  "department": "내과",
  "licenseNumber": "의사-12345",
  "specialties": ["일반내과", "소화기내과"],
  "metadata": { "boardCertified": true },
  "joinedAt": "2026-05-06T09:00:00Z"
}
```

---

### 5.3 PATCH /api/clinic/his/staff/:userId

**직원 HIS 정보 수정**

> 인증: API Key + Hospital Code

#### Request

```json
{
  "hisRole": "Doctor",
  "department": "소화기내과",
  "licenseNumber": "의사-12345",
  "specialties": ["일반내과", "소화기내과"],
  "metadata": { "boardCertified": true }
}
```

> 전달하지 않은 필드는 기존 값이 유지됩니다.

#### Response

```json
{ "ok": true, "message": "직원 정보가 수정되었습니다" }
```

---

### 5.4 GET /api/clinic/his/staff/:userId/status

**직원 근무 상태 조회** (오늘)

> 인증: API Key + Hospital Code

#### Response

```json
{
  "userId": "user-uuid-001",
  "workStatus": "checked_in",
  "checkInAt": "2026-05-06T08:30:00Z",
  "checkOutAt": null,
  "date": "2026-05-06"
}
```

| workStatus | 설명 |
|------------|------|
| `none` | 미출근 |
| `checked_in` | 출근 |
| `checked_out` | 퇴근 |
| `on_vacation` | 휴가 |
| `remote` | 재택 |

---

### 5.5 GET /api/clinic/his/staff/online

**현재 출근 중인 직원 목록**

> 인증: API Key + Hospital Code

#### Response

```json
{
  "online": [
    {
      "id": "user-uuid-001",
      "username": "김의사",
      "profileImage": "https://...",
      "hisRole": "Doctor",
      "department": "내과",
      "checkInAt": "2026-05-06T08:30:00Z"
    }
  ],
  "count": 15
}
```

---

## 6. API 키 관리

### 6.1 POST /api/clinic/his/api-keys

**API 키 발급**

> 인증: Clinic 세션 쿠키 (병원 OWNER/MANAGER만)

#### Request

```json
{
  "name": "HIS Production",
  "permissions": [],
  "ipWhitelist": ["10.0.0.1", "10.0.0.2"]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| name | string | 키 용도 이름 |
| permissions | string[] | 허용 API 그룹 (빈 배열 = 전체) |
| ipWhitelist | string[] | IP 제한 (빈 배열 = 제한 없음) |

#### Response

```json
{
  "ok": true,
  "key": "his_a1b2c3d4e5f6g7h8i9j0...",
  "prefix": "his_a1b2c3d4",
  "name": "HIS Production",
  "message": "API 키가 발급되었습니다. 이 키는 다시 조회할 수 없으므로 안전한 곳에 저장하세요."
}
```

> ⚠️ `key` 값은 이 응답에서 **1회만** 표시됩니다.

---

### 6.2 GET /api/clinic/his/api-keys

**발급된 API 키 목록** (키 값은 prefix만 표시)

> 인증: Clinic 세션 쿠키 (병원 OWNER/MANAGER만)

#### Response

```json
{
  "keys": [
    {
      "id": "key-uuid",
      "prefix": "his_a1b2c3d4",
      "name": "HIS Production",
      "permissions": [],
      "ipWhitelist": ["10.0.0.1"],
      "active": true,
      "lastUsedAt": "2026-05-06T10:00:00Z",
      "expiresAt": null,
      "createdAt": "2026-05-06T09:00:00Z"
    }
  ]
}
```

---

### 6.3 DELETE /api/clinic/his/api-keys

**API 키 비활성화**

> 인증: Clinic 세션 쿠키 (병원 OWNER/MANAGER만)

#### Request

```json
{ "keyId": "key-uuid" }
```

#### Response

```json
{ "ok": true, "message": "API 키가 비활성화되었습니다" }
```

> 비활성화된 키는 즉시 인증에 실패합니다. 복구할 수 없으므로 새로 발급하세요.

---

## 7. 조직도 API (전자결재 연동)

전자결재(W.Sign)에서 결재선을 구성할 때 HIS의 조직도(부서/직급/보고라인)를 조회합니다.
Clinic의 W.Sign 결재선에 HIS 조직 구조를 반영하여 적절한 결재자를 자동 추천합니다.

---

### 7.1 GET /api/clinic/his/organization

**조직도 전체 트리 조회** — 부서 계층 + 부서별 직원 목록

> 인증: API Key + Hospital Code

#### Response

```json
{
  "departments": [
    {
      "id": "dept-001",
      "name": "내과",
      "parentId": null,
      "head": {
        "userId": "user-uuid-001",
        "username": "김내과",
        "hisRole": "Doctor",
        "position": "과장"
      },
      "children": [
        {
          "id": "dept-001-1",
          "name": "소화기내과",
          "parentId": "dept-001",
          "head": {
            "userId": "user-uuid-010",
            "username": "박소화",
            "hisRole": "Doctor",
            "position": "부장"
          },
          "children": [],
          "members": [
            { "userId": "user-uuid-011", "username": "이전임", "hisRole": "Doctor", "position": "전임의" }
          ]
        }
      ],
      "members": [
        { "userId": "user-uuid-002", "username": "이간호", "hisRole": "Nurse", "position": "수간호사" },
        { "userId": "user-uuid-003", "username": "박간호", "hisRole": "Nurse", "position": "간호사" }
      ]
    },
    {
      "id": "dept-002",
      "name": "외과",
      "parentId": null,
      "head": {
        "userId": "user-uuid-004",
        "username": "최외과",
        "hisRole": "Doctor",
        "position": "과장"
      },
      "children": [],
      "members": [
        { "userId": "user-uuid-005", "username": "정간호", "hisRole": "Nurse", "position": "간호사" }
      ]
    },
    {
      "id": "dept-010",
      "name": "약제팀",
      "parentId": null,
      "head": {
        "userId": "user-uuid-006",
        "username": "강약사",
        "hisRole": "Pharmacist",
        "position": "팀장"
      },
      "children": [],
      "members": []
    },
    {
      "id": "dept-020",
      "name": "진단검사의학과",
      "parentId": null,
      "head": null,
      "children": [],
      "members": [
        { "userId": "user-uuid-007", "username": "윤기사", "hisRole": "LabTech", "position": "기사" }
      ]
    }
  ],
  "total": 4
}
```

#### 필드 명세

| 필드 | 타입 | 설명 |
|------|------|------|
| departments[].id | string | HIS 부서 ID |
| departments[].name | string | 부서명 |
| departments[].parentId | string? | 상위 부서 ID (최상위 = null) |
| departments[].head | object? | 부서장 정보 |
| departments[].children | array | 하위 부서 (재귀) |
| departments[].members | array | 소속 직원 목록 |
| members[].userId | string | Clinic 사용자 ID |
| members[].position | string | 직급 (과장/부장/수간호사/간호사/팀장/기사 등) |

---

### 7.2 GET /api/clinic/his/organization/department/:deptId

**부서 상세 + 직원 목록** — 특정 부서의 상세 정보

> 인증: API Key + Hospital Code

#### Response

```json
{
  "id": "dept-001",
  "name": "내과",
  "head": {
    "userId": "user-uuid-001",
    "username": "김내과",
    "hisRole": "Doctor",
    "position": "과장",
    "licenseNumber": "의사-12345",
    "phone": "010-1234-5678"
  },
  "members": [
    {
      "userId": "user-uuid-002",
      "username": "이간호",
      "hisRole": "Nurse",
      "position": "수간호사",
      "phone": "010-2345-6789"
    },
    {
      "userId": "user-uuid-003",
      "username": "박간호",
      "hisRole": "Nurse",
      "position": "간호사",
      "phone": null
    }
  ],
  "memberCount": 3
}
```

---

### 7.3 GET /api/clinic/his/organization/approvers

**결재선 추천** — 기안자 기준으로 결재자 후보 목록을 반환합니다.

> 인증: API Key + Hospital Code
> 용도: W.Sign 결재 기안 시 결재선 자동 구성

#### Query Parameters

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|:----:|------|
| userId | string | ✅ | 기안자 Clinic ID |
| type | string | | 결재 유형: `general` / `purchase` / `leave` / `medical` (기본: general) |

#### Response

```json
{
  "drafter": {
    "userId": "user-uuid-003",
    "username": "박간호",
    "department": "내과",
    "position": "간호사"
  },
  "recommendedLine": [
    {
      "step": 1,
      "type": "approve",
      "userId": "user-uuid-002",
      "username": "이간호",
      "department": "내과",
      "position": "수간호사",
      "reason": "직속 상급자"
    },
    {
      "step": 2,
      "type": "approve",
      "userId": "user-uuid-001",
      "username": "김내과",
      "department": "내과",
      "position": "과장",
      "reason": "부서장"
    },
    {
      "step": 3,
      "type": "final_approve",
      "userId": "user-uuid-100",
      "username": "홍원장",
      "department": null,
      "position": "원장",
      "reason": "최종 결재권자"
    }
  ],
  "ccCandidates": [
    {
      "userId": "user-uuid-050",
      "username": "정총무",
      "department": "행정팀",
      "position": "팀장",
      "reason": "행정 담당"
    }
  ]
}
```

#### 결재 유형별 결재선 로직

| type | 결재선 구성 |
|------|-----------|
| `general` | 직속 상급자 → 부서장 → 원장 |
| `purchase` | 직속 상급자 → 부서장 → 행정팀장 → 원장 |
| `leave` | 직속 상급자 → 부서장 |
| `medical` | 직속 상급자 → 부서장 → 진료부장 → 원장 |

---

### 7.4 POST /api/clinic/his/organization/sync

**조직도 동기화** — HIS 조직도 변경 사항을 Clinic에 반영합니다.

> 인증: API Key + Hospital Code
> 호출 타이밍: HIS에서 부서/직원 변경 시 또는 일일 배치

> ⭐ **v2 `staff[]` 포맷 (2026-07-17, 권장 — HIS→W.Sign push 동기화 B안)**: 사번(`employeeNumber`)·이메일·성명·부서·직위·재직상태(`status`: active|on_leave|resigned, 재직/휴직/퇴직 별칭 수용)·입사일(`hireDate`)·보고라인(`managerEmployeeNumber`, 사번→clinicUserId 해석) 수용. 식별=clinicUserId→email→자동생성(`options.autoCreate` 기본 true — 계정+카페멤버+전자결재멤버 일괄). 응답 `mappings[]`(employeeNumber↔clinicUserId)를 HIS `Staff.clinicUserId`에 왕복 저장. 멱등 upsert(재전송 시 created 0). 최대 1,000명/호출. **결재선 추천(7.3)이 이 보고라인 체인(직속→차상위, 휴직·퇴직 건너뛰기)을 1순위로 사용.** 전체 계약 예시 = `wsign-org-sync-reply-to-his-2026-07-17.md` §①. 아래 v1(departments/reportingLines)은 하위호환 유지.

#### Request

```json
{
  "departments": [
    {
      "id": "dept-001",
      "name": "내과",
      "parentId": null,
      "headUserId": "user-uuid-001",
      "members": [
        { "userId": "user-uuid-001", "position": "과장" },
        { "userId": "user-uuid-002", "position": "수간호사" },
        { "userId": "user-uuid-003", "position": "간호사" }
      ]
    }
  ],
  "reportingLines": [
    { "userId": "user-uuid-003", "reportsTo": "user-uuid-002" },
    { "userId": "user-uuid-002", "reportsTo": "user-uuid-001" }
  ]
}
```

#### Response

```json
{
  "ok": true,
  "synced": {
    "departments": 1,
    "members": 3,
    "reportingLines": 2
  }
}
```

---

## 8. 에러 응답 형식

모든 에러는 동일한 형식으로 반환됩니다.

```json
{
  "error": "에러 메시지",
  "statusCode": 400
}
```

| HTTP Status | 설명 |
|:-----------:|------|
| 400 | 잘못된 요청 (파라미터 오류) |
| 401 | 인증 실패 (API 키 없음/만료) |
| 403 | 권한 부족 (IP 차단/권한 없음) |
| 404 | 리소스 없음 |
| 429 | Rate Limit 초과 |
| 500 | 서버 오류 |

---

## 9. 연동 시작 가이드

### Step 1: API 키 발급

1. `clinic.example.org` 로그인
2. 대시보드 → 병원 카페 → 병원 워크그룹 관리 → 병원 코드 탭
3. 또는 API 호출: `POST /api/clinic/his/api-keys`

### Step 2: 연동 테스트

```bash
# 직원 목록 조회 테스트
curl -X GET "https://example.org/api/clinic/his/staff" \
  -H "Authorization: Bearer his_your_api_key_here" \
  -H "X-Hospital-Code: WRB-DEMO-M66M"
```

### Step 3: SSO 연동

```javascript
// HIS 서버 (NestJS 예시)
@Post('/sso')
async handleSso(@Body() body: { token: string }) {
  const res = await fetch('https://example.org/api/clinic/sso/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: body.token }),
  });
  const data = await res.json();
  if (!data.valid) throw new UnauthorizedException();

  // 자체 세션 생성
  return this.authService.createSession(data.user);
}
```

### Step 4: 역할 매핑

```bash
# 의사 역할 매핑
curl -X PUT "https://example.org/api/clinic/his/role-mapping" \
  -H "Authorization: Bearer his_xxx" \
  -H "X-Hospital-Code: WRB-DEMO-M66M" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid",
    "hisRole": "Doctor",
    "department": "내과",
    "licenseNumber": "의사-12345",
    "specialties": ["일반내과"]
  }'
```

---

## 10. 출근 체크리스트 데이터 API

의료진 출근 시 체크리스트에 표시할 데이터를 HIS가 Clinic에 제공합니다.
Clinic은 자체 데이터(인수인계/공지/일정)와 HIS 데이터를 병합하여 체크리스트를 구성합니다.

### 데이터 흐름

```
출근 버튼 클릭
  ├─ Clinic 자체: 인수인계 채널, 공지사항, 캘린더  (직접 조회)
  └─ HIS 데이터: 환자/검사/처방/재고/장비         (아래 API 호출)
       ↓
  체크리스트 모달 표시 → 항목 확인 → 업무 시작
```

---

### 9.1 POST /api/clinic/his/checklist/data

**HIS 체크리스트 데이터 Push** — HIS가 직원별 체크리스트 데이터를 Clinic에 전달합니다.

> 인증: API Key + Hospital Code
> 호출 타이밍: 직원 출근 시 Clinic이 HIS에 요청하거나, HIS가 주기적으로 Push

#### Request

```json
{
  "userId": "user-uuid-001",
  "date": "2026-05-07",
  "items": [
    {
      "key": "outpatient_count",
      "title": "오늘 외래 환자",
      "category": "clinical",
      "hisRole": "Doctor",
      "priority": "required",
      "status": "info",
      "summary": "예약 28명 · 초진 5명 · 재진 23명",
      "count": 28,
      "link": "https://his.example.org/outpatient/today",
      "details": [
        { "label": "초진", "value": 5 },
        { "label": "재진", "value": 23 },
        { "label": "주의 환자", "value": 2, "alert": true }
      ]
    },
    {
      "key": "pending_lab_results",
      "title": "미확인 검사 결과",
      "category": "clinical",
      "hisRole": "Doctor",
      "priority": "required",
      "status": "action_needed",
      "summary": "3건 미확인 (혈액 2, 영상 1)",
      "count": 3,
      "link": "https://his.example.org/lab/results?pending=true",
      "details": [
        { "label": "혈액검사", "value": 2 },
        { "label": "CT/MRI", "value": 1 }
      ]
    },
    {
      "key": "pending_prescriptions",
      "title": "처방 대기",
      "category": "clinical",
      "hisRole": "Doctor",
      "priority": "optional",
      "status": "info",
      "summary": "서명 대기 2건",
      "count": 2,
      "link": "https://his.example.org/orders/pending"
    },
    {
      "key": "inpatient_summary",
      "title": "입원 환자 현황",
      "category": "clinical",
      "hisRole": "Doctor",
      "priority": "optional",
      "status": "info",
      "summary": "담당 5명 · 신규입원 1명 · 퇴원예정 1명",
      "count": 5,
      "link": "https://his.example.org/inpatient/my",
      "details": [
        { "label": "총 담당", "value": 5 },
        { "label": "신규 입원", "value": 1 },
        { "label": "퇴원 예정", "value": 1 }
      ]
    }
  ]
}
```

#### 필드 명세

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| userId | string | ✅ | Clinic 사용자 ID |
| date | string | ✅ | 날짜 (YYYY-MM-DD) |
| items | array | ✅ | 체크리스트 항목 목록 |
| items[].key | string | ✅ | 항목 고유 키 (중복 시 덮어쓰기) |
| items[].title | string | ✅ | 표시 제목 |
| items[].category | string | ✅ | `clinical` / `safety` / `equipment` / `inventory` |
| items[].hisRole | string | ✅ | 대상 역할: `Doctor` / `Nurse` / `Pharmacist` / `LabTech` / `ALL` |
| items[].priority | string | | `required` / `optional` (기본: optional) |
| items[].status | string | | `info` / `action_needed` / `warning` / `critical` |
| items[].summary | string | | 한 줄 요약 텍스트 |
| items[].count | number | | 건수 (숫자 배지 표시) |
| items[].link | string | | HIS 상세 페이지 URL |
| items[].details | array | | 상세 항목 `[{ label, value, alert? }]` |

#### Response

```json
{
  "ok": true,
  "received": 4,
  "date": "2026-05-07",
  "userId": "user-uuid-001"
}
```

---

### 9.2 GET /api/clinic/his/checklist/data

**HIS 체크리스트 데이터 Pull** — Clinic이 특정 직원의 체크리스트 데이터를 HIS에 요청합니다.

> 인증: API Key + Hospital Code
> 용도: HIS가 Push하지 않은 경우 Clinic이 직접 Pull

#### Query Parameters

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|:----:|------|
| userId | string | ✅ | Clinic 사용자 ID |
| date | string | | 날짜 (기본: 오늘) |
| hisRole | string | | 역할 필터 |

#### Response

Push와 동일한 형식의 `items` 배열을 반환합니다.

```json
{
  "userId": "user-uuid-001",
  "date": "2026-05-07",
  "hisRole": "Doctor",
  "items": [ /* ... Push와 동일 형식 ... */ ]
}
```

---

### 9.3 직종별 체크리스트 항목 키 규격

HIS에서 전달하는 `key` 값의 표준 규격입니다.

#### 의사 (Doctor)

| key | title | 설명 |
|-----|-------|------|
| `outpatient_count` | 오늘 외래 환자 | 예약 환자 수 + 초진/재진 분류 |
| `pending_lab_results` | 미확인 검사 결과 | 혈액/영상/조직 결과 미확인 건수 |
| `pending_prescriptions` | 처방 대기 | 서명/확인 대기 중인 처방 |
| `inpatient_summary` | 입원 환자 현황 | 담당 입원 환자 수 + 변동 |
| `surgery_schedule` | 오늘 수술 일정 | 수술 예정 건수 + 시간 |
| `critical_patients` | 주의 환자 | 중증/위독 환자 알림 |

#### 간호사 (Nurse)

| key | title | 설명 |
|-----|-------|------|
| `ward_patient_count` | 병동 환자 현황 | 담당 병동 입원 환자 수 |
| `medication_schedule` | 투약 스케줄 | 오전 투약 예정 건수 |
| `fall_risk_patients` | 낙상 위험 환자 | Morse Scale 고위험 목록 |
| `vital_unchecked` | 바이탈 미측정 | 야간 바이탈 미측정 환자 |
| `new_admissions` | 신규 입원 | 오늘 입원 예정 환자 |
| `discharge_plan` | 퇴원 예정 | 오늘 퇴원 예정 환자 |

#### 약사 (Pharmacist)

| key | title | 설명 |
|-----|-------|------|
| `pending_dispensing` | 조제 대기 | 미처리 처방 건수 |
| `narcotic_inventory` | 마약류 재고 | 마약류/향정신성 약품 재고 현황 |
| `expiring_medications` | 유효기간 임박 | 30일 이내 만료 약품 |
| `dur_alerts` | DUR 경고 미처리 | 미확인 약물 상호작용 경고 |
| `stock_shortage` | 재고 부족 약품 | 안전재고 이하 약품 목록 |

#### 검사기사 (LabTech)

| key | title | 설명 |
|-----|-------|------|
| `pending_specimens` | 검체 대기 | 미처리 검체 수 |
| `equipment_maintenance` | 장비 점검 | 금일 정기 점검 예정 장비 |
| `qc_results` | QC 결과 | 정도관리 결과 이상 여부 |
| `urgent_tests` | 긴급 검사 | STAT 검사 대기 건수 |

#### 공통 (ALL)

| key | title | 설명 |
|-----|-------|------|
| `infection_alert` | 감염 경보 | 원내 감염 경보 (있을 때만) |
| `safety_notice` | 안전 공지 | 시설 점검, 소방 훈련 등 |
| `work_location` | 근무 위치 | 오늘 배정 병동/외래/수술실 |

---

### 9.4 status 값에 따른 UI 표현

| status | 아이콘 | 색상 | 동작 |
|--------|--------|------|------|
| `info` | ℹ️ | 파란색 | 정보 표시 (체크만) |
| `action_needed` | ⚠️ | 주황색 | 링크 클릭 유도 |
| `warning` | 🔶 | 빨간색 | 경고 강조 |
| `critical` | 🚨 | 빨간색 깜빡임 | 즉시 조치 필요 |

---

### 9.5 Bulk Push (전체 직원)

HIS에서 출근 시간대에 전체 직원의 체크리스트 데이터를 한 번에 Push할 수 있습니다.

#### POST /api/clinic/his/checklist/bulk

```json
{
  "date": "2026-05-07",
  "staff": [
    {
      "userId": "user-uuid-001",
      "items": [ /* Doctor 항목 */ ]
    },
    {
      "userId": "user-uuid-002",
      "items": [ /* Nurse 항목 */ ]
    }
  ]
}
```

#### Response

```json
{
  "ok": true,
  "processed": 2,
  "date": "2026-05-07"
}
```

> 💡 **권장**: HIS 서버에서 매일 07:00~08:00 사이에 Bulk Push를 실행하여
> 직원 출근 시 체크리스트 데이터가 준비되어 있도록 합니다.

---

## 11. 향후 Phase 2~5 (예정)

| Phase | API | 설명 | 상태 |
|:-----:|-----|------|:----:|
| 1 | SSO + API 키 + 역할 + 직원 | 인증 기반 | ✅ 완료 |
| 1.5 | 출근 체크리스트 데이터 | HIS→Clinic 체크리스트 Push/Pull | ✅ 명세 완료 |
| 2 | 알림 + 채널 메시지 | 실시간 소통 연동 | 예정 |
| 3 | 캘린더 + 근태 | 일정/근무 동기화 | 예정 |
| 4 | 전자결재 + Wiki | 문서 연동 | 예정 |
| 5 | Webhook | Clinic → HIS 실시간 콜백 | 예정 |

---

## 12. 문의

- 기술 지원: contact@example.org
- 전화: 070-7799-2772

---

> WeRU.B Clinic API v1.1.0 — 2026-05-07
