// Created: 2026-06-11
// Hospital Web 에러코드 레지스트리 — 메인앱 src/lib/error-codes.ts와 동일 컨벤션
// 포맷: [E-{화면접두어}-{NNN}] — HW-* 접두어

export function ec(screenPrefix: string, num: number): string {
  return `[E-${screenPrefix}-${String(num).padStart(3, "0")}]`;
}

export const ERROR_CODES = {
  "HW-LOGIN": {
    sc: "C-HW-LOGIN",
    desc: "병원 로그인",
    "001": "로그인 실패",
    "002": "서버에 연결할 수 없습니다",
    "003": "병원 코드 확인 실패",
  },
  "HW-SIGNUP": {
    sc: "C-HW-SIGNUP",
    desc: "병원 직원 가입",
    "001": "가입 실패",
  },
  "HW-REG": {
    sc: "C-HW-REG",
    desc: "병원 등록",
    "001": "병원 등록 실패",
  },
  "HW-HANDOFF": {
    sc: "C-HW-HANDOFF",
    desc: "인수인계",
    "004": "수신 확인 실패",
  },
} as const;
