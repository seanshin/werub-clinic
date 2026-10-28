// Created: 2026-05-07
// Updated: 2026-05-07 — [C-1] secret 해시 저장, [H-3] Zod 검증, [M-2] SSRF URL 검증
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";
import { z } from "zod";
import crypto from "crypto";

const VALID_EVENTS = [
  "wsign.approved", "wsign.rejected", "wsign.withdrawn",
  "attendance.checkin", "attendance.checkout",
  "calendar.created", "calendar.updated",
  "member.joined", "member.left",
  "checklist.completed",
  // HIS 팀 문서 추가 이벤트
  "leave.approved", "leave.rejected",
  "channel.message",
];

const webhookSchema = z.object({
  url: z.string().url().startsWith("https://", "HTTPS URL만 허용됩니다"),
  events: z.array(z.enum(VALID_EVENTS as [string, ...string[]])).min(1),
  secret: z.string().min(16, "secret은 16자 이상이어야 합니다"),
});

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "notify");
    const body = await request.json();
    const data = webhookSchema.parse(body);

    // [M-2] SSRF 방지 — 내부 IP 차단
    try {
      const urlObj = new URL(data.url);
      const host = urlObj.hostname;
      if (host === "localhost" || host === "127.0.0.1" || host === "::1" ||
          host.startsWith("10.") || host.startsWith("192.168.") ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        throw new BadRequestError("내부 네트워크 URL은 사용할 수 없습니다");
      }
    } catch (e) {
      if (e instanceof BadRequestError) throw e;
    }

    // [C-1] secret 해시 저장
    const secretHash = hashSecret(data.secret);

    const rows = await prisma.$queryRaw<[{ id: string }]>`INSERT INTO his_webhooks (id, cafe_id, url, events, secret)
       VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${data.url}, ${data.events}, ${secretHash})
       RETURNING id`;

    // [M-1] 감사 로그
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_WEBHOOK_CREATE", { cafeId: ctx.cafeId, webhookId: rows[0].id, url: data.url, events: data.events });
    } catch {}

    return NextResponse.json({ ok: true, webhookId: rows[0].id, events: data.events });
  } catch (err) { return handleError(err); }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "notify");
    const rows = await prisma.$queryRaw<Array<{
      id: string; url: string; events: string[]; is_active: boolean;
      last_triggered_at: Date | null; failure_count: number; created_at: Date;
    }>>`SELECT id, url, events, is_active, last_triggered_at, failure_count, created_at
       FROM his_webhooks WHERE cafe_id = ${ctx.cafeId} ORDER BY created_at DESC`;

    return NextResponse.json({
      webhooks: rows.map(r => ({
        id: r.id, url: r.url, events: r.events, active: r.is_active,
        lastTriggeredAt: r.last_triggered_at, failureCount: r.failure_count, createdAt: r.created_at,
      })),
    });
  } catch (err) { return handleError(err); }
}
