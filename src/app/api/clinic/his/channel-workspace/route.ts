// Created: 2026-07-17 14:35
// HIS 전용 W.Channel 워크스페이스 프로비저닝 — his-wchannel-workspace.plan.md P1
// POST: 병원당 1개 온디맨드 생성(멱등). GET: 현황 / DELETE: 링크 비활성(워크스페이스 보존).
// 프로비저닝 코어는 src/lib/his/channel-provision.ts 공용(관리자 세션 경로와 공유). HIS 키 위임 인가.
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg-pool";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { getChannelLinkStatus, provisionChannelWorkspace, unlinkChannelWorkspace } from "@/lib/his/channel-provision";

const provisionSchema = z.object({
  name: z.string().min(1).max(60).nullish(),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, "slug는 영소문자/숫자/하이픈").nullish(),
  description: z.string().max(255).nullish(),
});

// GET — 프로비저닝 현황
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const status = await getChannelLinkStatus(ctx.cafeId);
    return NextResponse.json({ provisioned: !!status?.active, workspace: status });
  } catch (err) { return handleError(err); }
}

// POST — 워크스페이스 생성 (병원당 1개, 멱등)
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    await rateLimit(request, "write");
    const data = provisionSchema.parse(await request.json().catch(() => ({})));

    // 소유자 = 병원 카페 OWNER 승계 (폴백 = HIS 키 발급자)
    const ownerRows = await pool.query(
      `SELECT user_id FROM cafe_members WHERE cafe_id = $1 AND role = 'OWNER' ORDER BY joined_at ASC LIMIT 1`, [ctx.cafeId]);
    let ownerId: string | null = ownerRows.rows[0]?.user_id ?? null;
    if (!ownerId) {
      const keyRows = await pool.query(`SELECT created_by FROM his_api_keys WHERE id = $1`, [ctx.apiKeyId]);
      ownerId = keyRows.rows[0]?.created_by ?? null;
    }
    if (!ownerId) throw new BadRequestError("워크스페이스 소유자를 결정할 수 없습니다(병원 OWNER 부재)");

    const res = await provisionChannelWorkspace({
      hospitalCafeId: ctx.cafeId, hospitalCafeName: ctx.cafeName, hospitalCode: ctx.hospitalCode, ownerId,
      name: data.name, slug: data.slug, description: data.description,
    });
    if (res.idempotent) return NextResponse.json({ ok: true, idempotent: true, workspace: res.workspace });
    return NextResponse.json({
      ok: true, workspace: res.workspace,
      next: "조직도 등록: POST /api/clinic/his/channel-workspace/org-sync (staff[] — organization/sync v2와 동일 스키마)",
    }, { status: 201 });
  } catch (err) { return handleError(err); }
}

// DELETE — 링크 비활성 (워크스페이스는 보존)
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    await rateLimit(request, "write");
    await unlinkChannelWorkspace(ctx.cafeId);
    return NextResponse.json({ ok: true, message: "연결을 해제했습니다(워크스페이스는 보존)" });
  } catch (err) { return handleError(err); }
}
