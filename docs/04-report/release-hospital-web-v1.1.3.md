# hospital-web v1.1.3 릴리즈 노트 (v1.1.1 ~ v1.1.3)

> **서비스**: 병원웹 (`clinic.example.org` · :3600 · PM2 `werub-hospital`) · **날짜**: 2026-08-19 · **이전**: v1.1.0

- **1.1.1** 로그인 때 확인한 병원을 `clinic_preferred_cafe`로 기억 → 12페이지의 `/api/clinic/context?cafe=`(`lib/clinic-context.ts`) → 서버(메인 8.50.0)가 소속 검증 후 primary. 이전엔 코드 Y로 로그인해도 가장 오래된 X 병원. 로그아웃 시 삭제
- **1.1.2** `middleware.ts` **진입 게이트** — 공개 `/`,`/login`,`/register`,`/signup`
- **1.1.3** 게이트 리다이렉트 절대 URL(공통 패치)

정책 메모(미변경): `/clinic/join` 무승인 자동 가입 · `verify` 무인증 노출 — 승인 단계는 `cafe_members.status=PENDING` + 승인 UI가 함께 필요한 제품 결정.
검증: `/dashboard` 쿠키 없음 → 307 `/login?redirect=%2Fdashboard` · 번들 `clinic_preferred_cafe` 13청크.
