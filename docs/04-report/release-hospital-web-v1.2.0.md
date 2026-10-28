# hospital-web v1.2.0 릴리즈 노트

> **서비스**: 병원웹 (`clinic.example.org` · :3600) · **날짜**: 2026-08-19 · **이전**: v1.1.3

- 로그인 화면을 **auth-ui `LoginForm`으로 교체**: 병원 코드는 `renderBeforeForm` 슬롯(확인 전 제출 차단), 합류는 `onLoggedIn`(await, 2FA 경로 포함), 헤더 "W.Clinic — 병원 플랫폼" 병기, 문구 AUTH_COPY, 선호 병원 기억(1.1.1) 유지.
- **실버그 수정 — 소셜 로그인 복귀**: 이전엔 `from=hospital`을 보내 메인 콜백 `SERVICE_URLS`에 없어 **메인 홈으로 떨어졌고 `code`도 버려졌다**. 이제 `from=clinic` + 복귀 URL(`/login?code=…&social=1`) 동봉 → 복귀 시 로그인 상태면 자동 합류 후 대시보드.
- `<title>` "WeRU.B Clinic — 병원 통합 플랫폼" → **"W.Clinic — 병원 플랫폼"** · 프로필 "계정 설정 (WeRU.B ID)" → "(WeRU.B 계정)".

## 1.2.1 (2026-08-19, 명칭 단일화 3차 — 헤더·랜딩 내비)
- 헤더 브랜드 "W. Clinic"→"W.Clinic", 서비스 내비 "커뮤니티·Enterprise·Channel"→"WeRU.B·W.Work·W.Channel", 랜딩 '다른 서비스' 카드명 정본
