// Created: 2026-05-06
// 로그 시스템 공용 타입 정의
// 모든 로그 관련 타입은 이 파일에서 관리

export type LogLevel = "ERROR" | "WARN" | "INFO";
export type LogSource = "client" | "server" | "admin" | "cron";

/**
 * 로그 카테고리 — 타입 안전한 문자열 union
 * 새 카테고리 추가 시 여기에 등록 + categories.ts에 라벨 추가
 */
export type LogCategory =
  // 클라이언트 에러
  | "CLIENT_JS_ERROR"
  | "CLIENT_REACT_ERROR"
  | "CLIENT_NETWORK_ERROR"
  // 서버 에러
  | "SERVER_500"
  | "SERVER_TIMEOUT"
  | "MALFORMED_MULTIPART"
  // 감사 로그 (관리자 행위)
  | "ADMIN_COMMENT_DELETE"
  | "ADMIN_POST_DELETE"
  | "ADMIN_USER_BAN"
  | "ADMIN_CONFIG_CHANGE"
  | "ADMIN_REPORT_RESOLVE"
  | "ADMIN_ROLE_CHANGE"
  | "ADMIN_DATA_EXPORT"
  | "CERT_ISSUANCE"
  | "ASSET_MGMT"
  | "HR_LIFECYCLE"
  | "AI_CLI"
  | "VISION_MGMT"
  | "ADMIN_RECORDING_DELETE"
  | "ADMIN_AI_IMAGE_MARK"
  | "ADMIN_INTEGRATION_SERVICE"
  // 운영
  | "DEPLOY_EVENT"
  | "CRON_FAILURE"
  | "CRON_RUN"
  | "RATE_LIMIT_HIT"
  | "AUTH_FAILURE"
  | "SECURITY_ALERT"
  // HIS 연동
  | "HIS_API_ERROR"
  | "HIS_API_TIMEOUT"
  | "HIS_WSIGN_REQUEST"
  | "HIS_WSIGN_CALLBACK"
  | "HIS_WEBHOOK_CREATE"
  | "HIS_CALLBACK_SECRET_SET"
  | "HIS_CALLBACK_SECRET_CLEAR"
  | "HIS_ORG_SYNC"
  | "HIS_CHANNEL_PROVISION"
  | "HOSPITAL_APPROVAL_REQUEST"
  | "CAFE_NOTICE_DISPATCH"
  | "HIS_SSO_TICKET"
  | "HIS_SSO_LOGIN"
  | "WSIGN_REMINDER"
  | "MANAGE_DOC_SCAN"
  // 결제/구독
  | "BILLING_KEY_ISSUED"
  | "SUBSCRIPTION_RENEWED"
  | "SUBSCRIPTION_FAILED"
  // Email 서비스(W.Mail) 연동
  | "EMAIL_WEBHOOK"
  | "EMAIL_ACCOUNT"
  // 화상회의
  | "MEETING_WEBHOOK"
  | "MEETING_ANALYSIS";

/** DB error_logs 테이블 1행에 대응하는 구조체 */
export interface LogEntry {
  level: LogLevel;
  source: LogSource;
  category: LogCategory;
  message: string;
  errorCode?: string;     // [E-SCREEN-NNN]
  url?: string;
  fetchUrl?: string;
  status?: number;
  stack?: string;
  userId?: string;
  userAgent?: string;
  ip?: string;
  extra?: Record<string, unknown>;  // JSONB
}

/** 클라이언트 에러 페이로드 (ErrorBoundary / global handler에서 전송) */
export interface ClientErrorPayload {
  type: "JS_ERROR" | "REACT_ERROR" | "NETWORK_ERROR";
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  fetchUrl?: string;
  status?: number;
  userAgent: string;
  userId?: string;
  ts: number;
  [key: string]: unknown;
}
