// Created: 2026-02-19
// Updated: 2026-04-07 — Resend 우선 + Nodemailer 폴백 + 콘솔 폴백
// Updated: 2026-08-03 — EmailProvider 체인으로 리팩터링 (Email 마이크로서비스 연동)
//   Rest(Email 서비스 :4200) → Local(현행 Resend→SMTP) → 콘솔, 3단 graceful 폴백.
//   sendEmail() 시그니처 무변경 — 기존 30여 호출처 무수정 (Email/docs/01-plan/email-service-plan.md §11).
//   패턴: wsign-attestation.ts (provider 인터페이스 + 팩토리 캐시 + graceful 폴백)

import { getSecretValue } from "@/lib/services/secrets.service";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  /** 발신 표시 이름 override — 주소는 전역 발신자 유지, 이름만 교체 (예: "회사명 via WeRU.B") */
  fromName?: string;
  /** 발송 카테고리 — Email 서비스의 증적/보존 정책 분기 (미지정 시 notify) */
  category?: "auth" | "invite" | "notify" | "legal" | "bulk";
}

/** 표시명 새니타이즈 — 헤더 인젝션(CRLF)·구분자 제거. 전 provider 공통 방어. */
function sanitizeFromName(fromName?: string): string | undefined {
  const s = fromName?.trim().replace(/[<>"\r\n]/g, "");
  return s || undefined;
}

/** 기본 발신자 문자열("이름 <addr>" 또는 "addr")에 fromName 적용 */
function applyFromName(defaultFrom: string, fromName?: string): string {
  const clean = sanitizeFromName(fromName);
  if (!clean) return defaultFrom;
  const addr = defaultFrom.match(/<([^>]+)>/)?.[1] ?? defaultFrom.trim();
  return `${clean} <${addr}>`;
}

// ─── Provider 인터페이스 ──────────────────────────────────────────────────

interface EmailProvider {
  readonly id: string;
  send(options: SendEmailOptions): Promise<{ sent: boolean }>;
}

// ─── Rest — Email 마이크로서비스 (1순위) ──────────────────────────────────
// POST {EMAIL_SERVICE_URL}/v1/messages (x-service-token) — 큐 기반 비동기 발송.
// 202 수신 = 발송 큐 적재 성공(sent 취급). 실패/미설정 시 Local 폴백.

class RestEmailProvider implements EmailProvider {
  readonly id = "rest";
  constructor(private baseUrl: string, private serviceToken: string) {}

  async send(options: SendEmailOptions): Promise<{ sent: boolean }> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-token": this.serviceToken,
        },
        body: JSON.stringify({
          to: [options.to],
          subject: options.subject,
          html: options.html,
          fromName: sanitizeFromName(options.fromName), // Rest 경로도 CRLF/구분자 방어 (Local과 일관)
          category: options.category ?? "notify",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error(`[Email/Rest] Email 서비스 응답 ${res.status} — Local 폴백`);
        return { sent: false };
      }
      return { sent: true }; // 202 { data: { messageId } } — 큐 적재 완료
    } catch (err) {
      console.error("[Email/Rest] Email 서비스 호출 실패 — Local 폴백:", err instanceof Error ? err.message : err);
      return { sent: false };
    }
  }
}

// ─── Local — 현행 Resend → SMTP (2순위, 무변경 유지) ─────────────────────

async function sendViaResend(options: SendEmailOptions): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY ?? (await getSecretValue("RESEND_API_KEY"));
  if (!apiKey) return { sent: false };

  const from = applyFromName(
    process.env.RESEND_FROM ?? (await getSecretValue("RESEND_FROM")) ?? "WeRU.B <noreply@example.org>",
    options.fromName,
  );

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    if (error) {
      console.error("[Email/Resend] 발송 실패:", error);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error("[Email/Resend] 에러:", err);
    return { sent: false };
  }
}

import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;
let _initPromise: Promise<nodemailer.Transporter | null> | null = null;

async function getTransporter(): Promise<nodemailer.Transporter | null> {
  if (transporter) return transporter;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const [host, user, pass] = await Promise.all([
      getSecretValue("SMTP_HOST"),
      getSecretValue("SMTP_USER"),
      getSecretValue("SMTP_PASS"),
    ]);
    if (!host || !user || !pass) {
      _initPromise = null;
      return null;
    }
    const portStr = await getSecretValue("SMTP_PORT");
    const port = Number(portStr) || 587;
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    return transporter;
  })();
  return _initPromise;
}

async function sendViaSmtp(options: SendEmailOptions): Promise<{ sent: boolean }> {
  const tp = await getTransporter();
  if (!tp) return { sent: false };
  try {
    const from = applyFromName((await getSecretValue("SMTP_FROM")) || "WeRU.B <noreply@example.org>", options.fromName);
    await tp.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    return { sent: true };
  } catch (err) {
    console.error("[Email/SMTP] 발송 실패:", err);
    return { sent: false };
  }
}

class LocalEmailProvider implements EmailProvider {
  readonly id = "local";
  async send(options: SendEmailOptions): Promise<{ sent: boolean }> {
    const resendResult = await sendViaResend(options);
    if (resendResult.sent) return resendResult;
    return sendViaSmtp(options);
  }
}

// ─── 팩토리 — 호출마다 설정 해석 ─────────────────────────────────────────
// 별도 캐시를 두지 않는다: getSecretValue가 자체 TTL 캐시를 갖고 setSecret 시
// invalidateCache로 무효화되므로, 관리자 화면의 EMAIL_SERVICE_* 변경이 재배포
// 없이 다음 발송부터 반영된다 (여기서 캐시하면 그 경로가 끊긴다).

async function getRestProvider(): Promise<RestEmailProvider | null> {
  const baseUrl = (await getSecretValue("EMAIL_SERVICE_URL").catch(() => "")) || "";
  const token = (await getSecretValue("EMAIL_SERVICE_SECRET").catch(() => "")) || "";
  return baseUrl && token ? new RestEmailProvider(baseUrl.replace(/\/$/, ""), token) : null;
}

// ─── 통합 발송 (시그니처 무변경) ──────────────────────────────────────────

export async function sendEmail(options: SendEmailOptions): Promise<{ sent: boolean }> {
  // 1. Email 마이크로서비스 (설정 시 우선) — 큐/재시도/추적/증적은 서비스가 담당
  const rest = await getRestProvider();
  if (rest) {
    const restResult = await rest.send(options);
    if (restResult.sent) return restResult;
    // 서비스 장애 → Local 폴백 (기획서 §3.1 graceful degradation)
  }

  // 2. Local — 현행 Resend → SMTP
  const localResult = await new LocalEmailProvider().send(options);
  if (localResult.sent) return localResult;

  // 3. 콘솔 폴백 — 개발 환경
  console.log("=".repeat(60));
  console.log("[Email] Rest+Resend+SMTP 모두 미설정/실패 — 콘솔 출력");
  console.log(`To: ${options.to}`);
  console.log(`Subject: ${options.subject}`);
  console.log("-".repeat(60));
  console.log(options.html.replace(/<[^>]*>/g, ""));
  console.log("=".repeat(60));
  return { sent: false };
}
