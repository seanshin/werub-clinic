// Created: 2026-07-17 14:40
// HIS → W.Channel 워크스페이스 조직도 등록/동기화 — his-wchannel-workspace.plan.md P2
// body = organization/sync v2와 동일 staff[] 스키마(HIS 어댑터 재사용). 대상 = his_channel_links 위임 워크스페이스.
// 처리: staff 동기화(계정/멤버/wsign멤버/보고라인) + WsignOrgTree 부서 트리 자동 생성 + is_dept_head 판정.
// 조직도 정본 = HIS 데이터 (결정 4 — 채널 내 수동 편집은 다음 sync에서 HIS 기준으로 재구성됨).
import { NextRequest, NextResponse } from "next/server";
import { requireHisAuth } from "@/lib/his/auth";
import { syncStaffToCafe, rebuildDeptOrgTree, updateDeptHeads, getActiveChannelLink } from "@/lib/his/org-sync";
import { handleError, BadRequestError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const staffItemSchema = z.object({
  employeeNumber: z.string().max(50).nullish(),
  email: z.string().email().nullish(),
  clinicUserId: z.string().nullish(),
  name: z.string().max(50).nullish(),
  department: z.string().max(100).nullish(),
  position: z.string().max(50).nullish(),
  status: z.string().max(30).nullish(),
  hireDate: z.string().max(30).nullish(),
  managerEmployeeNumber: z.string().max(50).nullish(),
  hisRole: z.string().max(30).nullish(),
});

const syncSchema = z.object({
  staff: z.array(staffItemSchema).min(1).max(1000),
  options: z.object({ autoCreate: z.boolean().optional() }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    await rateLimit(request, "write");
    const data = syncSchema.parse(await request.json());

    const link = await getActiveChannelLink(ctx.cafeId);
    if (!link) throw new BadRequestError("연결된 채널 워크스페이스가 없습니다 — 먼저 POST /api/clinic/his/channel-workspace로 생성하세요");

    const autoCreate = data.options?.autoCreate !== false;
    const result = await syncStaffToCafe(link.channelCafeId, data.staff, { autoCreate });
    const depts = await rebuildDeptOrgTree(link.channelCafeId);
    const deptHeads = await updateDeptHeads(link.channelCafeId);

    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_ORG_SYNC", {
        cafeId: ctx.cafeId, target: "channel", channelCafeId: link.channelCafeId,
        staff: data.staff.length, created: result.created, updated: result.updated, skipped: result.skipped,
        reportingLines: result.reportingLines, depts, deptHeads,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      channelCafeId: link.channelCafeId,
      synced: {
        staff: data.staff.length, created: result.created, updated: result.updated, skipped: result.skipped,
        reportingLines: result.reportingLines, depts, deptHeads,
      },
      mappings: result.mappings,
      errors: result.errors,
    });
  } catch (err) { return handleError(err); }
}
