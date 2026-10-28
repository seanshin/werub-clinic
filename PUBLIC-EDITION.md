# Clinic 병원 서비스 — 공개판 안내

**Clinic 병원 서비스 — about this public edition**

> **EN** — This repository is the public edition of Clinic 병원 서비스 v1.4.0. Development continues in a private repository; this edition is its final state with internal working records (reports and replies exchanged with other systems, key-rotation runbooks, server measurements) and operational details removed, licensed under MIT. Operational domains, server addresses and accounts were replaced with example values, and **every password, secret, token and key was emptied to `CHANGE_ME`** — you must set your own before running anything. The table below lists each emptied setting and where it appears.

이 저장소는 **Clinic 병원 서비스 v1.4.0 의 공개판**입니다. 개발은 비공개 저장소에서 계속하고, 공개판은 그 최종 상태에서 다음을 빼거나 바꾼 것입니다(MIT).

| 무엇 | 어떻게 |
|---|---|
| 내부 작업 기록 | 다른 시스템과 주고받은 결함 보고 · 회신, 키 교체 런북, 서버 실측 등 7873개 문서를 뺐습니다. 소스 주석이 빠진 문서를 가리키는 곳이 남아 있을 수 있습니다 |
| 운영 정보 | 운영 도메인 · 서버 주소 · 서버 계정을 예시 값(`example.org` · 문서용 IP 대역 · `deploy`)으로 바꿨습니다 |
| 🔴 비밀값 | 비밀번호 · 비밀 · 토큰 · 키 **9곳**을 `CHANGE_ME` 로 비웠습니다. **실행 전에 아래 값을 직접 정하십시오** |

## 직접 설정할 값

| 설정 이름 | 있는 곳 |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `packages/hospital-web/.env.example`(비어 있음) |
| `token` | `docs/01-plan/clinic-his-api.md` · `docs/02-design/clinic-his-api-spec.md` · `docs/02-design/his-workgroup-api-spec.md` |

- 같은 이름이 여러 곳에 있으면 **모두 같은 값**이어야 하는지(서로 맞물리는 연동 비밀) 확인하십시오.
- 값은 길고 무작위로 만드십시오(예: `openssl rand -base64 32`). 저장소에 다시 커밋하지 마십시오.

## 켜기 전에 기관이 정할 보안 설정

아래 기능은 공개판에서 **설정하지 않으면 안전한 쪽으로 멈추거나 꺼져 있습니다.** 기관의 운영 절차에 맞춰 직접 정하십시오.

| 설정 | 무엇을 정하나 |
|---|---|
| `JWT_SECRET · SECRETS_SALT` | 저장 비밀 암호화의 키 재료입니다. 운영(`NODE_ENV=production`)에서 비어 있으면 **기동을 거부**합니다. 개발 모드에서만 고정 개발 값으로 동작하니 운영에서는 반드시 정하십시오. |
| `HIS 연동 API 키` | HIS 가 Clinic 을 부를 때 쓰는 키입니다(데이터베이스의 키 표). 키마다 **허용 IP 목록**(`ip_whitelist`)을 둘 수 있으니 HIS 서버 주소로 좁히십시오. |
| `HIS_URL · HIS_API_KEY` | Clinic 이 HIS 를 부를 주소와 키입니다. HIS 쪽에 등록한 값과 같아야 합니다. |

- 코드 안의 개발용 기본값은 운영에서 반드시 환경 변수로 덮어쓰십시오.
- 이 생태계 전체의 소개 · 구축 순서: [werub-his-ecosystem](https://github.com/seanshin/werub-his-ecosystem)
