# Clinic — 병원 서비스 (공개판)

이 저장소는 Clinic(병원 협업 · 커뮤니티 플랫폼) 가운데 **병원 서비스 부분만** 옮긴 공개판입니다. 위루비 HIS 생태계에서 HIS 와 맞물리는 자리를 보여 주려는 것입니다.

> **EN** — Public edition of only the hospital-service part of Clinic: the hospital staff web app and the hospital-service / HIS-integration API routes of the main app, with the library code those routes use. The community platform itself (main app, other packages, database schema) is not included, so this edition does not run on its own.

## 들어 있는 것

| 경로 | 무엇 |
|---|---|
| `packages/hospital-web/` | 병원 직원용 웹 화면(Next.js) — 대시보드 · 층별 현황 · 인수인계 · 투약 · 수술 현황판 · 근무표 · 알림 |
| `packages/api-core/` | 화면이 쓰는 API 클라이언트 |
| `src/app/api/clinic/` | 메인앱의 병원 서비스 · HIS 연동 API 라우트(HIS 프록시 · SSO · 웹훅 수신 · 전자결재 연동 등) |
| `src/lib/` | 위 라우트가 쓰는 라이브러리만(인증 · 로깅 · HIS 연동 · 알림 · 전자결재) |
| `docs/` | 병원 서비스 · HIS 연동 API 명세와 병원 서비스 릴리즈 기록 |

## 들어 있지 않은 것 — 단독으로 실행되지 않습니다

- **메인앱(커뮤니티 플랫폼)** 본체 · 다른 패키지 · **데이터베이스 스키마(Prisma)** · 배포 구성은 싣지 않았습니다.
- 그래서 `src/app/api/clinic/` 과 `src/lib/` 는 **읽기용 참고 구현**입니다. 이 폴더만으로는 빌드되지 않습니다.
- `packages/hospital-web/` 은 따로 빌드되지만, 부르는 API(`/api/clinic/*` · `/api/cafes/*` · 인증 · 알림)를 제공하는 메인앱이 있어야 동작합니다.

HIS 쪽 연동 계약과 설치 순서는 생태계 소개 저장소를 보십시오: [werub-his-ecosystem](https://github.com/seanshin/werub-his-ecosystem)

## 라이선스

MIT — `LICENSE` 를 보십시오. 받은 뒤 직접 정할 값은 `PUBLIC-EDITION.md` 에 있습니다.
