# hospital-web v1.4.0 릴리즈 노트

> **서비스**: 병원웹 (`clinic.example.org` · :3600) · **날짜**: 2026-08-19 · **이전**: v1.3.2
> 배경: 랜딩 인벤토리 잔여 2건 — "인수인계 병동 `3f` 고정", "설정 탭 폴링·임계·알림이 저장만 되고 소비 코드 없음"

## 인수인계 — 병동 선택
- 병동(=층) 드롭다운 추가. 목록은 `fetchFloorPlans()`(HIS `/floor/plans`), 미연동이면 mock 6개 층으로 폴백되며 **"데모" 배지** 표시
- 기본값은 기존과 같은 `3f` — 기존 이력과 이어진다(ward_id 완전일치 조회). 선택 시 템플릿·이력 자동 재조회
- `wardLabel()`로 이력의 `ward_id`를 층 이름으로 표시(상세 API가 `wardName`에 원값을 넣는 것 보정)

## 설정 — 저장만 되던 값 실제 소비
- **폴링 주기 소비**: `entityPollingInterval`(엔티티) · `statsPollingInterval`(통계·흐름·개요·대시보드 위젯) → `src/app/floor/page.tsx` 3곳 + `FloorOverview` + `FloorWidget`. `pollMs()`가 3초 미만·NaN을 기본값으로 보정
- **알림 3종 토글 소비**: 대기초과·정원초과·의료진부재 알림이 꺼져 있으면 브라우저 알림 생략
- **중복 알림 억제(실버그)**: 5초 폴링마다 같은 critical 알림을 계속 다시 띄우던 것 → 알림 id 기억, 해소되면 다시 알림 대상으로 복귀
- **얕은 병합 버그**: `getFloorSettings()`가 `{...DEFAULTS, ...saved}` 라 중첩 객체(`congestionThresholds`/`alerts`)가 통째로 덮여 하위 키 추가 시 `undefined`가 되던 것 → 키 단위 병합
- **혼잡도 임계값**: 등급은 여전히 HIS 서버 판정값을 사용한다(클라이언트 재판정은 서버 판정 무력화 위험). 설정 패널에 **안내 배너** 추가 — 값은 저장되고 서버 전달 연동 후 반영
