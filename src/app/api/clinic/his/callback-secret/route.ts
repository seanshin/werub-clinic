// Created: 2026-07-16 11:55
// HIS 결과 콜백(HMAC 서명) 시크릿 등록/조회/삭제 — HIS가 자기 API 키 인증으로 자체 로테이션.
// 저장 = his_callback_secrets(cafe별 1행, AES-256-GCM 암호화 — 해시가 아니라 복호화 가능해야 서명에 사용 가능).
// 로테이션 절차: HIS가 새 시크릿 PUT → 즉시 이후 콜백부터 새 시크릿 서명(무중단, 구 시크릿 병행창 없음 — PUT 직후 HIS측 검증 시크릿도 교체).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const secretSchema = z.object({
  secret: z.string().min(16, "secret은 16자 이상이어야 합니다").max(200),
});

// GET — 등록 여부 조회 (시크릿 값은 반환하지 않음)
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "wsign");
    const rows = await prisma.$queryRaw<{ updated_at: Date }[]>`
      SELECT updated_at FROM his_callback_secrets WHERE cafe_id = ${ctx.cafeId}`;
    return NextResponse.json({
      configured: rows.length > 0,
      updatedAt: rows[0]?.updated_at ?? null,
    });
  } catch (err) { return handleError(err); }
}

// PUT — 시크릿 등록/로테이션
export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "wsign");
    await rateLimit(request, "write");
    const { secret } = secretSchema.parse(await request.json());

    const { encryptValue } = await import("@/lib/services/secrets.service");
    const enc = encryptValue(secret);
    await prisma.$executeRaw`
      INSERT INTO his_callback_secrets (cafe_id, secret_enc, updated_at)
      VALUES (${ctx.cafeId}, ${enc}, now())
      ON CONFLICT (cafe_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, updated_at = now()`;

    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_CALLBACK_SECRET_SET", { cafeId: ctx.cafeId, apiKeyId: ctx.apiKeyId });
    } catch {}
    return NextResponse.json({ ok: true, message: "콜백 서명 시크릿이 등록되었습니다. 이후 발송 콜백부터 적용됩니다." });
  } catch (err) { return handleError(err); }
}

// DELETE — 시크릿 삭제 (이후 콜백 미서명 다운그레이드). 실수/E2E 유실 방지: 명시 confirm 필요(보안 M2).
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "wsign");
    await rateLimit(request, "write");
    const confirm = new URL(request.url).searchParams.get("confirm");
    if (confirm !== "true") {
      return NextResponse.json({ error: "시크릿 삭제 시 콜백이 미서명 상태로 다운그레이드됩니다. ?confirm=true로 명시 확인하세요.", code: "CONFIRM_REQUIRED" }, { status: 400 });
    }
    await prisma.$executeRaw`DELETE FROM his_callback_secrets WHERE cafe_id = ${ctx.cafeId}`;
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_CALLBACK_SECRET_CLEAR", { cafeId: ctx.cafeId, apiKeyId: ctx.apiKeyId });
    } catch {}
    return NextResponse.json({ ok: true, message: "콜백 서명 시크릿이 삭제되었습니다" });
  } catch (err) { return handleError(err); }
}
