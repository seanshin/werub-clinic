// Created: 2026-05-07
// Updated: 2026-05-07 — [H-2] prisma 전환, [H-3] Zod, [H-4] category 화이트리스트, [M-1] 감사 로그
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

// HIS 팀 문서 카테고리 통합: lab_result, prescription, appointment, admission, surgery, emergency, system + HIS 접두어 호환
const HIS_CATEGORIES = [
  "HIS_ALERT", "HIS_URGENT", "HIS_LAB_RESULT", "HIS_PRESCRIPTION", "HIS_ADMISSION",
  "HIS_EMERGENCY", "HIS_SURGERY", "HIS_SCHEDULE", "HIS_HANDOFF", "HIS_CHECKLIST",
  "HIS_APPOINTMENT", "HIS_SYSTEM",
  // HIS 팀 문서의 소문자 카테고리도 허용
  "lab_result", "prescription", "appointment", "admission", "surgery", "emergency", "system",
] as const;

const notifySchema = z.object({
  recipients: z.array(z.string()).min(1).max(1000),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional().default("normal"),
  link: z.string().url().max(500).optional(),
  category: z.enum(HIS_CATEGORIES).optional().default("HIS_ALERT"),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "notify");
    await rateLimit(request, "write");
    const body = await request.json();
    const data = notifySchema.parse(body);

    let userIds: string[] = [];
    if (data.recipients.includes("all")) {
      const rows = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM cafe_members WHERE cafe_id = ${ctx.cafeId}`;
      userIds = rows.map(r => r.user_id);
    } else if (data.recipients[0]?.startsWith("department:")) {
      const dept = data.recipients[0].slice(11);
      const rows = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM his_role_mappings WHERE cafe_id = ${ctx.cafeId} AND department = ${dept}`;
      userIds = rows.map(r => r.user_id);
    } else {
      userIds = data.recipients;
    }

    // [H-2] prisma 사용. M5: 단일 INSERT(N+1 제거) — unnest로 대상자 일괄 삽입.
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length > 0) {
      // 2026-08-20: type 에 HIS_* 카테고리를 그대로 넣어 enum 오류, `link` 컬럼도 없어 **항상 실패**했다.
      //   → 유효 enum(EXTERNAL_NOTICE) + link_url 사용, 카테고리는 제목에 보존한다.
      await prisma.$executeRaw`INSERT INTO notifications (id, user_id, type, title, message, link_url, created_at)
         SELECT gen_random_uuid()::text, uid, 'EXTERNAL_NOTICE'::"NotificationType", ${`[${data.category}] ${data.title}`}, ${data.message}, ${data.link ?? null}, now()
         FROM unnest(${uniqueIds}::text[]) AS uid`;
    }
    const notifCount = uniqueIds.length;

    // [M-1] 감사 로그
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_NOTIFY", { cafeId: ctx.cafeId, category: data.category, recipientCount: userIds.length });
    } catch {}

    return NextResponse.json({ ok: true, sent: notifCount });
  } catch (err) { return handleError(err); }
}
