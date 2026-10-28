// Created: 2026-07-20
// HIS 결재선 자동 추천 — in-process 공용 함수 (H2). GET /organization/approvers 와
// POST /wsign/request(autoApproverType)가 동일 로직을 HTTP 왕복 없이 호출.
// 규칙: 기안자→직속 상급자(보고라인)→차상위(최대 2인). 휴직·퇴직·비활성 제외, 비활성 hop은 그 위로 승계.
//       보고라인 없으면 직위 휴리스틱 폴백. leave는 부서장까지(owner 미추가).
import { prisma } from "@/lib/prisma";

export interface RecommendedApprover {
  step: number; type: string; userId: string; username: string;
  department: string | null; position: string | null; reason: string;
}
export interface ApproverRecommendation {
  drafter: { userId: string; username: string; department: string | null; position: string | null };
  recommendedLine: RecommendedApprover[];
  ccCandidates: Array<{ userId: string; username: string; department: string | null; position: string | null; reason: string }>;
}

/** rawType(HR_LEAVE·leave·purchase·medical…)을 정규화 */
export function normalizeApproverType(rawType?: string | null): "leave" | "purchase" | "medical" | "general" {
  const t = (rawType ?? "general").toLowerCase();
  return t.includes("leave") ? "leave" : t.includes("purchase") ? "purchase" : t.includes("medical") ? "medical" : "general";
}

/** 결재선 자동 추천 (in-process). userId 미존재 시 null. */
export async function resolveRecommendedApprovers(
  cafeId: string, userId: string, rawType?: string | null,
): Promise<ApproverRecommendation | null> {
  const type = normalizeApproverType(rawType);

  const drafterRows = await prisma.$queryRaw<Array<{
    username: string; department: string | null; position: string | null; his_role: string; reports_to: string | null;
  }>>`SELECT u.username, rm.department, rm.metadata->>'position' as position, rm.his_role, rm.metadata->>'reportsTo' as reports_to
     FROM users u LEFT JOIN his_role_mappings rm ON rm.user_id = u.id AND rm.cafe_id = ${cafeId}
     WHERE u.id = ${userId}`;
  const drafter = drafterRows[0];
  if (!drafter) return null;

  // ① 보고라인 체인 — 최대 2인, 휴직·퇴직 제외(비활성 hop은 그 위로 승계)
  const chain: Array<{ user_id: string; username: string; department: string | null; position: string | null }> = [];
  {
    let cur = drafter.reports_to;
    const seen = new Set<string>([userId]);
    for (let hop = 0; cur && chain.length < 2 && hop < 6; hop++) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const rows = await prisma.$queryRaw<Array<{
        user_id: string; username: string; department: string | null; position: string | null;
        status: string | null; reports_to: string | null;
      }>>`SELECT rm.user_id, u.username, rm.department, rm.metadata->>'position' as position,
                rm.metadata->>'status' as status, rm.metadata->>'reportsTo' as reports_to
         FROM his_role_mappings rm JOIN users u ON u.id = rm.user_id
         WHERE rm.cafe_id = ${cafeId} AND rm.user_id = ${cur}`;
      const node = rows[0];
      if (!node) break;
      if (node.status === "resigned" || node.status === "on_leave") { cur = node.reports_to; continue; }
      chain.push({ user_id: node.user_id, username: node.username, department: node.department, position: node.position });
      cur = node.reports_to;
    }
  }

  // 같은 부서 상급자 — 활성(cafe_members ACTIVE) + 재직만 (C1/M1)
  const superiors = await prisma.$queryRaw<Array<{
    user_id: string; username: string; department: string | null; position: string | null;
    his_role: string; clinic_role: string;
  }>>`SELECT rm.user_id, u.username, rm.department, rm.metadata->>'position' as position,
            rm.his_role, cm.role as clinic_role
     FROM his_role_mappings rm
     JOIN users u ON u.id = rm.user_id
     JOIN cafe_members cm ON cm.cafe_id = rm.cafe_id AND cm.user_id = rm.user_id
     WHERE rm.cafe_id = ${cafeId} AND rm.user_id != ${userId}
       AND cm.status = 'ACTIVE'
       AND COALESCE(rm.metadata->>'status', 'active') NOT IN ('resigned', 'on_leave')
     ORDER BY
       CASE cm.role WHEN 'OWNER' THEN 1 WHEN 'MANAGER' THEN 2 ELSE 3 END,
       CASE rm.his_role WHEN 'Admin' THEN 1 WHEN 'Doctor' THEN 2 ELSE 3 END`;

  const sameDept = superiors.filter(s => s.department === drafter.department);
  const deptHead = sameDept.find(s => s.position === "과장" || s.position === "부장" || s.position === "팀장");
  const directSuperior = sameDept.find(s => s.position === "수간호사" || s.position === "팀장" || s.his_role === "Doctor");
  const owner = superiors.find(s => s.clinic_role === "OWNER");
  const adminHead = superiors.find(s => s.department === "행정팀" && (s.position === "팀장" || s.clinic_role === "MANAGER"));

  const line: RecommendedApprover[] = [];
  let step = 1;

  if (chain.length > 0) {
    chain.forEach((c, i) => {
      line.push({ step: step++, type: "approve", userId: c.user_id, username: c.username, department: c.department, position: c.position, reason: i === 0 ? "직속 상급자(보고라인)" : "차상위(보고라인)" });
    });
  } else {
    if (directSuperior && directSuperior !== deptHead) {
      line.push({ step: step++, type: "approve", userId: directSuperior.user_id, username: directSuperior.username, department: directSuperior.department, position: directSuperior.position, reason: "직속 상급자" });
    }
    if (deptHead) {
      line.push({ step: step++, type: "approve", userId: deptHead.user_id, username: deptHead.username, department: deptHead.department, position: deptHead.position, reason: "부서장" });
    }
  }
  if (type === "purchase" && adminHead && !line.find(l => l.userId === adminHead.user_id)) {
    line.push({ step: step++, type: "approve", userId: adminHead.user_id, username: adminHead.username, department: adminHead.department, position: adminHead.position, reason: "행정 담당" });
  }
  if (type !== "leave" && owner && !line.find(l => l.userId === owner.user_id)) {
    line.push({ step: step++, type: "final_approve", userId: owner.user_id, username: owner.username, department: null, position: owner.position ?? "원장", reason: "최종 결재권자" });
  }
  if (line.length === 0) {
    const fallback = adminHead ?? owner ?? superiors.find(s => s.clinic_role === "MANAGER") ?? superiors[0];
    if (fallback) {
      line.push({ step: step++, type: "final_approve", userId: fallback.user_id, username: fallback.username, department: fallback.department ?? null, position: fallback.position ?? null, reason: "폴백 결재권자 (조직도 직위 미등록)" });
    }
  }

  const ccCandidates: ApproverRecommendation["ccCandidates"] = [];
  if (type === "purchase" && adminHead && !line.find(l => l.userId === adminHead.user_id)) {
    ccCandidates.push({ userId: adminHead.user_id, username: adminHead.username, department: adminHead.department, position: adminHead.position, reason: "행정 담당" });
  }

  return {
    drafter: { userId, username: drafter.username, department: drafter.department, position: drafter.position },
    recommendedLine: line,
    ccCandidates,
  };
}
