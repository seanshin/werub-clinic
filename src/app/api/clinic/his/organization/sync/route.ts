// Created: 2026-05-07
// Updated: 2026-07-17 — v2 staff[] 포맷 신설(HIS→W.Sign 조직도 push 동기화, B안):
//   사번/이메일/성명/부서/직위/재직상태/입사일/보고라인(managerEmployeeNumber) 수용 ·
//   식별=clinicUserId→email→autoCreate(계정+카페멤버+wsign멤버) · 매핑(employeeNumber↔clinicUserId) 왕복 반환.
//   기존 v1(departments/reportingLines) 포맷은 하위호환 유지.
// POST /api/clinic/his/organization/sync — HIS → Clinic 조직도 동기화
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { syncStaffToCafe, rebuildDeptOrgTree, updateDeptHeads, getActiveChannelLink, type StaffSyncResult } from "@/lib/his/org-sync";
import { handleError, BadRequestError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const pickCounts = (r: StaffSyncResult) => ({ created: r.created, updated: r.updated, skipped: r.skipped, reportingLines: r.reportingLines });

// nullish: HIS 직렬화가 미보유 필드를 null로 보내는 케이스 수용 (2026-07-17 HIS 피드백 — 널 불허로 최상위 직원 push 실패)
const staffItemSchema = z.object({
  employeeNumber: z.string().max(50).nullish(),
  email: z.string().email().nullish(),
  clinicUserId: z.string().nullish(),
  name: z.string().max(50).nullish(),
  department: z.string().max(100).nullish(),
  position: z.string().max(50).nullish(),
  status: z.string().max(30).nullish(), // active|on_leave|resigned (재직/휴직/퇴직 별칭 수용)
  hireDate: z.string().max(30).nullish(),
  managerEmployeeNumber: z.string().max(50).nullish(),
  hisRole: z.string().max(30).nullish(),
});

const v2Schema = z.object({
  staff: z.array(staffItemSchema).min(1).max(1000),
  options: z.object({ autoCreate: z.boolean().optional(), syncChannels: z.boolean().optional() }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    await rateLimit(request, "write");
    const body = await request.json();

    // ── v2: staff[] 포맷 (파이프라인 = src/lib/his/org-sync.ts 공용 모듈) ──
    if (Array.isArray(body?.staff)) {
      const data = v2Schema.parse(body);
      const autoCreate = data.options?.autoCreate !== false; // 기본 true
      const result = await syncStaffToCafe(ctx.cafeId, data.staff, { autoCreate });
      // 병원 카페 자신도 조직도 트리·부서장 재구성 (채널 워크스페이스와 대칭 — W.Sign 조직도 UI/부서장 배지)
      const depts = await rebuildDeptOrgTree(ctx.cafeId);
      const deptHeads = await updateDeptHeads(ctx.cafeId);

      // 연결된 W.Channel 워크스페이스 동반 갱신 (기본 on — options.syncChannels=false로 끔)
      let channelSync: Record<string, unknown> | null = null;
      if (data.options?.syncChannels !== false) {
        const link = await getActiveChannelLink(ctx.cafeId);
        if (link) {
          const chResult = await syncStaffToCafe(link.channelCafeId, data.staff, { autoCreate });
          const depts = await rebuildDeptOrgTree(link.channelCafeId);
          const heads = await updateDeptHeads(link.channelCafeId);
          channelSync = { channelCafeId: link.channelCafeId, ...pickCounts(chResult), depts, deptHeads: heads };
        }
      }

      try {
        const { logger } = await import("@/lib/logger");
        logger.audit("HIS_ORG_SYNC", { cafeId: ctx.cafeId, target: "clinic", staff: data.staff.length, ...pickCounts(result), depts, deptHeads, channelSync: !!channelSync });
      } catch {}

      return NextResponse.json({
        ok: true,
        synced: { staff: data.staff.length, created: result.created, updated: result.updated, skipped: result.skipped, reportingLines: result.reportingLines, depts, deptHeads },
        channelSync, // 링크된 채널 워크스페이스 동반 갱신 결과 (없으면 null)
        mappings: result.mappings, // employeeNumber↔clinicUserId 왕복 저장용 (HIS Staff.clinicUserId)
        errors: result.errors,
      });
    }

    // ── v1: departments/reportingLines 포맷 (하위호환) ──
    const { departments, reportingLines } = body;

    if (!departments || !Array.isArray(departments)) throw new BadRequestError("departments 배열 또는 staff 배열이 필요합니다");

    let memberCount = 0;

    for (const dept of departments) {
      if (!dept.members || !Array.isArray(dept.members)) continue;
      for (const m of dept.members) {
        // UPSERT role mapping with department + position
        const _hisRole = m.hisRole ?? null;
        const _position = m.position ?? null;
        const _deptId = dept.id ?? null;
        const _headUserId = dept.headUserId ?? null;
        await prisma.$executeRaw`INSERT INTO his_role_mappings (id, cafe_id, user_id, his_role, department, metadata, updated_at)
           VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${m.userId}, COALESCE(${_hisRole}, 'Staff'), ${dept.name},
             jsonb_build_object('position', ${_position}, 'deptId', ${_deptId}, 'headUserId', ${_headUserId}), now())
           ON CONFLICT (cafe_id, user_id) DO UPDATE SET
             department = ${dept.name},
             metadata = his_role_mappings.metadata || jsonb_build_object('position', ${_position}, 'deptId', ${_deptId}, 'headUserId', ${_headUserId}),
             updated_at = now()`;
        memberCount++;
      }
    }

    // 보고라인 저장
    let rlCount = 0;
    if (reportingLines && Array.isArray(reportingLines)) {
      for (const rl of reportingLines) {
        await prisma.$executeRaw`UPDATE his_role_mappings SET metadata = metadata || jsonb_build_object('reportsTo', ${rl.reportsTo}), updated_at = now()
           WHERE cafe_id = ${ctx.cafeId} AND user_id = ${rl.userId}`;
        rlCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      synced: { departments: departments.length, members: memberCount, reportingLines: rlCount },
    });
  } catch (err) { return handleError(err); }
}
