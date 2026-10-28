# hospital-web v1.3.1 릴리즈 노트

> **서비스**: 병원웹 (`clinic.example.org` · :3600) · **날짜**: 2026-08-19 · **이전**: v1.3.0
> 배경: 랜딩 인벤토리에서 "인수인계 수신확인은 표시만, 인수자 지정 UI 없음"이 드러남(`docs/reports/2026-08-19-landing-feature-expansion.md` §2)

- 인수인계 작성 화면에 **인수자 선택**(같은 병원 멤버, 선택 안 함 가능) → 저장 시 `toUserId/toName` 동봉
- 이력 탭 각 기록에 **"수신 확인" 버튼**(미확인 + 작성자 본인 아님) → `PATCH /api/clinic/handoff` → 확인됨 배지. 오류는 `[E-HW-HANDOFF-004]`
- 이력·타임라인의 "A → B" 표기가 실제 인수자명을 표시(이전엔 항상 빈 값)
- 에러코드 레지스트리 `HW-HANDOFF`, `HW-LOGIN-003` 등록
