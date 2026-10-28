// Created: 2026-05-06
// 로그 카테고리 전수 목록 + 한글 라벨
// grep "CATEGORY_LABELS" 으로 전체 카테고리 확인 가능

import type { LogCategory } from "./types";

/** 카테고리별 한글 라벨 — Admin 대시보드 표시용 */
export const CATEGORY_LABELS: Record<LogCategory, string> = {
  // 클라이언트 에러
  CLIENT_JS_ERROR:        "클라이언트 JS 에러",
  CLIENT_REACT_ERROR:     "React 렌더링 에러",
  CLIENT_NETWORK_ERROR:   "네트워크 에러",
  // 서버 에러
  SERVER_500:             "서버 500 에러",
  SERVER_TIMEOUT:         "서버 타임아웃",
  MALFORMED_MULTIPART:    "첨부 본문 형식 오류",
  // 감사 로그
  ADMIN_COMMENT_DELETE:   "관리자 댓글 삭제",
  ADMIN_POST_DELETE:      "관리자 게시글 삭제",
  ADMIN_USER_BAN:         "사용자 차단/정지",
  ADMIN_CONFIG_CHANGE:    "설정 변경",
  ADMIN_REPORT_RESOLVE:   "신고 처리",
  ADMIN_ROLE_CHANGE:      "권한 변경",
  ADMIN_DATA_EXPORT:      "데이터 내보내기",
  CERT_ISSUANCE:          "증명서 발급/재발급/대장",
  ASSET_MGMT:             "IT 자산관리",
  HR_LIFECYCLE:           "입퇴사 처리",
  AI_CLI:                 "그룹웨어 AI CLI",
  VISION_MGMT:            "모토/비전·목표 관리",
  ADMIN_RECORDING_DELETE: "화상회의 녹화 삭제",
  ADMIN_AI_IMAGE_MARK:    "AI 이미지 판정 정정",
  ADMIN_INTEGRATION_SERVICE: "연동 서비스 관리(등록/승인/정책)",
  // 운영
  DEPLOY_EVENT:           "배포 이벤트",
  CRON_FAILURE:           "크론 작업 실패",
  CRON_RUN:               "크론 실행 흔적(정상)",
  RATE_LIMIT_HIT:         "Rate Limit 초과",
  AUTH_FAILURE:            "인증 실패",
  SECURITY_ALERT:         "보안 알림",
  // HIS 연동
  HIS_API_ERROR:          "HIS API 오류",
  HIS_API_TIMEOUT:        "HIS API 타임아웃",
  HIS_WSIGN_REQUEST:      "HIS 전자결재 기안",
  HIS_WSIGN_CALLBACK:     "HIS 전자결재 결과 콜백",
  HIS_WEBHOOK_CREATE:     "HIS 웹훅 생성",
  HIS_CALLBACK_SECRET_SET:   "HIS 콜백 시크릿 등록",
  HIS_CALLBACK_SECRET_CLEAR: "HIS 콜백 시크릿 삭제",
  HIS_ORG_SYNC:              "HIS 조직도 동기화(v2)",
  HIS_CHANNEL_PROVISION:     "HIS 채널 워크스페이스 프로비저닝",
  HOSPITAL_APPROVAL_REQUEST: "병원 카페 생성 승인요청",
  CAFE_NOTICE_DISPATCH:      "카페 공지 → 연동 채널 전송",
  HIS_SSO_TICKET:            "HIS 열람 SSO 티켓 발급",
  HIS_SSO_LOGIN:             "HIS 열람 SSO 로그인",
  WSIGN_REMINDER:            "W.Sign 결재 독촉",
  MANAGE_DOC_SCAN:           "W.Manage 명함·사업자등록증 스캔",
  // 결제/구독
  BILLING_KEY_ISSUED:     "빌링키 발급",
  SUBSCRIPTION_RENEWED:   "구독 자동 갱신",
  SUBSCRIPTION_FAILED:    "구독 갱신 실패",
  // Email 서비스(W.Mail) 연동
  EMAIL_WEBHOOK:          "Email 발송 상태 웹훅",
  EMAIL_ACCOUNT:          "메일 계정/앱 비밀번호",
  // 화상회의
  MEETING_WEBHOOK:        "화상회의 웹훅(Jitsi)",
  MEETING_ANALYSIS:       "화상회의 AI 분석·회의록",
};

/** 감사 로그 카테고리 목록 (ADMIN_ 접두어) */
export const AUDIT_CATEGORIES: LogCategory[] = Object.keys(CATEGORY_LABELS)
  .filter(k => k.startsWith("ADMIN_")) as LogCategory[];

/** 에러 카테고리 목록 */
export const ERROR_CATEGORIES: LogCategory[] = [
  "CLIENT_JS_ERROR", "CLIENT_REACT_ERROR", "CLIENT_NETWORK_ERROR",
  "SERVER_500", "SERVER_TIMEOUT", "MALFORMED_MULTIPART",
];
