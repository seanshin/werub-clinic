// Created: 2026-07-16 11:40
// HIS 결과 콜백(callbackUrl 직접 방식) 발송 — eventId(멱등) + HMAC-SHA256 서명 + 재시도.
// 서명 시크릿은 his_callback_secrets(cafe별, AES-256-GCM 암호화 저장 — /api/clinic/his/callback-secret로 HIS가 자체 등록/로테이션).
// 서명 규약: core = {event,eventId,timestamp,hospitalCode,data}의 JSON 문자열, signature = "sha256=" + hex(HMAC-SHA256(secret, coreJson)).
//   최종 body = coreJson 마지막 "}" 앞에 ,"signature":"..." 삽입 → 수신측은 raw body에서 /,"signature":"[^"]*"\}$/ 를 "}"로 치환한 문자열로 검증.
//   동일 서명값을 X-Clinic-Signature 헤더로도 전송(헤더 검증 권장).
// 재시도: 3회(10s/60s/300s), 프로세스 생존 전제 best-effort. 절대 throw하지 않음.
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface HisCallbackCore {
  event: string;
  eventId: string;
  timestamp: string;
  hospitalCode: string | null;
  data: Record<string, unknown>;
}

const RETRY_DELAYS_MS = [10_000, 60_000, 300_000];

// 문서 상태: 한글(내부) → 영문(HIS 계약 — pending|approved|rejected|withdrawn)
const DOC_STATUS_EN: Record<string, string> = {
  "검토중": "pending", "보류": "pending",
  "승인완료": "approved",
  "반려": "rejected",
  "취소": "withdrawn", "임시저장": "withdrawn", // 회수(recall) 시 임시저장 복원 = HIS 관점 withdrawn
};
export function mapDocStatusEn(status: string): string {
  return DOC_STATUS_EN[status] ?? "pending";
}

/** cafe별 콜백 서명 시크릿 조회(복호화). 미등록이면 null → 미서명 발송(하위호환). */
export async function getHisCallbackSecret(cafeId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ secret_enc: string }[]>`
      SELECT secret_enc FROM his_callback_secrets WHERE cafe_id = ${cafeId}`;
    if (rows.length === 0 || !rows[0].secret_enc) return null;
    const { decryptValue } = await import("@/lib/services/secrets.service");
    return decryptValue(rows[0].secret_enc);
  } catch {
    return null; // 테이블 미존재/복호화 실패 = 미서명 발송
  }
}

/** 병원 코드(cafes.enterprise_code — raw 컬럼, Prisma 모델 밖) */
export async function getHospitalCode(cafeId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ enterprise_code: string | null }[]>`
      SELECT enterprise_code FROM cafes WHERE id = ${cafeId}`;
    return rows[0]?.enterprise_code ?? null;
  } catch {
    return null;
  }
}

export function buildSignedBody(core: HisCallbackCore, secret: string | null): { body: string; signature: string | null } {
  // 2026-07-17: body = 순수 페이로드(coreJson), 서명은 헤더 전용 (표준 웹훅 방식 — GitHub/Stripe).
  //   HIS 검증 = "HMAC-SHA256(원문 body)"와 자동 정합: 전송 body 전체가 곧 서명 대상이므로 재직렬화·후미 제거 불필요.
  //   (구: body에 signature 필드 삽입 → HIS가 전체 body를 HMAC하면 불일치·401. 리허설에서 실측 확인.)
  const body = JSON.stringify(core);
  if (!secret) return { body, signature: null };
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  return { body, signature };
}

/** 콜백 전송 + 재시도. 호출부는 void로 fire-and-forget(내부에서 전부 처리). */
export async function deliverHisCallback(url: string, core: HisCallbackCore, secret: string | null): Promise<boolean> {
  const { body, signature } = buildSignedBody(core, secret);
  // SSRF: DNS 해석까지 검증(호스트→내부IP·리바인딩 차단). 실패 시 발송 중단.
  try {
    const { assertSafeOutboundUrl } = await import("@/lib/url-validator");
    await assertSafeOutboundUrl(url);
  } catch (e) {
    logger.warn("HIS_API_ERROR", "HIS wsign 콜백 URL 차단(SSRF)", { eventId: core.eventId, url, error: (e as Error).message });
    return false;
  }
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        redirect: "manual", // 리다이렉트로 내부 타깃 우회 차단
        headers: {
          "Content-Type": "application/json",
          ...(signature ? { "X-Clinic-Signature": signature } : {}),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        logger.audit("HIS_WSIGN_CALLBACK", { event: core.event, eventId: core.eventId, signed: !!signature, attempt });
        return true;
      }
      logger.warn("HIS_API_ERROR", `HIS wsign 콜백 응답 ${res.status}`, { event: core.event, eventId: core.eventId, attempt });
    } catch (e) {
      logger.warn("HIS_API_ERROR", "HIS wsign 콜백 전송 실패", { event: core.event, eventId: core.eventId, attempt, error: (e as Error).message });
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  return false;
}
