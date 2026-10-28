// Created: 2026-07-19
// 의료기관(hospital/clinic) 전자결재 문서함 카테고리 시드 — clinic-wsign-category-system.plan.md §3.2
// ⚠️ 격리(I4): isClinicCafeType 아니면 시드하지 않음. 비-병원 워크스페이스에 병원 폴더 생성 금지.
import { prisma } from "@/lib/prisma";

/** cafeType이 의료기관(hospital/clinic)인지 — 서버 안전(클라 상수 의존 없음) */
export const isClinicCafeType = (cafeType?: string | null) =>
  cafeType === "hospital" || cafeType === "clinic";

/** 병원 문서함 표준 폴더 6종 (color 키 = doc-categories 팔레트: gray/red/amber/teal/blue/purple 등) */
export const CLINIC_DOC_CATEGORY_PRESET: { name: string; color: string; icon: string; order: number }[] = [
  { name: "인사·근태", color: "blue", icon: "🧑‍⚕️", order: 1 },
  { name: "진료·의무기록", color: "teal", icon: "📋", order: 2 },
  { name: "보험·심사", color: "purple", icon: "🛡️", order: 3 },
  { name: "구매·재무", color: "amber", icon: "💳", order: 4 },
  { name: "감염·안전·질관리", color: "red", icon: "🚨", order: 5 }, // docType과 정확히 일치(자동배치 name===docType)
  { name: "원무·행정", color: "gray", icon: "🏥", order: 6 },
];

/**
 * 병원 표준 결재라인 3종 시드 — 신규 온보딩 자동화 (기존 수동 스크립트 대체).
 * - cafeType 가드(I4) + **결재라인이 0개일 때만** 시드(병원이 의도 삭제한 라인 재생성 방지)
 * - 대표자(원장/부서장/행정)를 실 조직에서 조회 — 부족하면 조용히 스킵(조직 싱크 후 재시도 가능)
 */
export async function seedClinicApprovalLines(
  cafeId: string,
  cafeType?: string | null,
): Promise<{ seeded: number; skipped: boolean }> {
  if (!isClinicCafeType(cafeType)) return { seeded: 0, skipped: true };
  const existing = await prisma.wsignApprovalLine.count({ where: { cafeId } });
  if (existing > 0) return { seeded: 0, skipped: true }; // 첫 온보딩만

  const pick = async (rows: { user_id: string }[]) => rows[0]?.user_id ?? null;
  const owner = await pick(await prisma.$queryRaw`SELECT user_id FROM wsign_members WHERE cafe_id = ${cafeId} AND active = true AND (display_name LIKE '%원장%' OR display_name LIKE '%이사장%') ORDER BY (display_name LIKE '%의료원장%') DESC LIMIT 1`);
  const head = await pick(await prisma.$queryRaw`SELECT user_id FROM wsign_members WHERE cafe_id = ${cafeId} AND active = true AND is_dept_head = true LIMIT 1`);
  const admin = await pick(await prisma.$queryRaw`SELECT wm.user_id FROM wsign_members wm JOIN his_role_mappings rm ON rm.cafe_id = wm.cafe_id AND rm.user_id = wm.user_id WHERE wm.cafe_id = ${cafeId} AND wm.active = true AND rm.department LIKE '행정%' LIMIT 1`);
  const H1 = head ?? admin;
  const OWNER = owner ?? admin;
  if (!H1 || !OWNER) return { seeded: 0, skipped: true }; // 조직 데이터 미비 — 싱크 후 재호출 시 시드

  const lines = [
    { name: "표준 결재선 (부서장 → 원장)", description: "일반 결재 — 부서장 검토 후 원장 최종승인", deadlineDays: 3, amountThreshold: null as number | null,
      stepsJson: [{ memberId: H1, role: "결재" }, { memberId: OWNER, role: "최종승인" }] },
    { name: "휴가·근태 결재선 (부서장 전결)", description: "HR 휴가·근태정정·초과근무 — 부서장 최종승인", deadlineDays: 3, amountThreshold: null as number | null,
      stepsJson: [{ memberId: H1, role: "최종승인" }] },
    { name: "구매 결재선 (부서장 → 행정 → 원장)", description: "재무·구매 — 금액 100만원 이상", deadlineDays: 5, amountThreshold: 1000000 as number | null,
      stepsJson: [{ memberId: H1, role: "결재" }, ...(admin && admin !== H1 && admin !== OWNER ? [{ memberId: admin, role: "합의" }] : []), { memberId: OWNER, role: "최종승인" }] },
  ];
  let seeded = 0;
  for (const l of lines) {
    // 자기결재·중복 제거 후 1단계 이상일 때만
    const steps = l.stepsJson.filter((s, i, a) => a.findIndex((x) => x.memberId === s.memberId) === i);
    if (steps.length === 0) continue;
    await prisma.wsignApprovalLine.create({
      data: { cafeId, name: l.name, description: l.description, mode: "sequential", amountThreshold: l.amountThreshold, stepsJson: steps, deadlineDays: l.deadlineDays },
    });
    seeded++;
  }
  return { seeded, skipped: false };
}

/** 병원 템플릿 docType별 기본 결재선 연결 — default_line_id가 NULL인 것만(수동 설정 존중). 멱등. */
export async function linkClinicTemplateDefaultLines(
  cafeId: string,
  cafeType?: string | null,
): Promise<number> {
  if (!isClinicCafeType(cafeType)) return 0;
  const lines = await prisma.wsignApprovalLine.findMany({ where: { cafeId }, select: { id: true, name: true } });
  const find = (kw: string) => lines.find((l) => l.name.includes(kw))?.id ?? null;
  const leaveLine = find("휴가");
  const purchaseLine = find("구매");
  const standard = find("표준");
  let linked = 0;
  const apply = async (docType: string | null, lineId: string | null) => {
    if (!lineId) return;
    const r = await prisma.wsignTemplate.updateMany({
      where: { cafeId, defaultLineId: null, ...(docType ? { docType } : {}) },
      data: { defaultLineId: lineId },
    });
    linked += r.count;
  };
  await apply("인사·근태", leaveLine);
  await apply("구매·재무", purchaseLine);
  await apply(null, standard); // 나머지 전부 표준
  return linked;
}

/**
 * 병원 워크스페이스에 표준 문서함 카테고리를 멱등 시드.
 * - cafeType이 hospital/clinic이 아니면 즉시 반환(격리 I4)
 * - 동명 카테고리가 이미 있으면 건너뜀(멱등)
 */
export async function seedClinicDocCategories(
  cafeId: string,
  cafeType?: string | null,
  createdBy = "system",
): Promise<{ seeded: number; skipped: boolean }> {
  if (!isClinicCafeType(cafeType)) return { seeded: 0, skipped: true };

  const existing = await prisma.wsignDocCategory.findMany({
    where: { cafeId },
    select: { name: true },
  });
  const have = new Set(existing.map((c) => c.name));

  let seeded = 0;
  for (const preset of CLINIC_DOC_CATEGORY_PRESET) {
    if (have.has(preset.name)) continue;
    await prisma.wsignDocCategory.create({
      data: {
        cafeId,
        name: preset.name,
        color: preset.color,
        icon: preset.icon,
        order: preset.order,
        createdBy,
      },
    });
    seeded++;
  }
  return { seeded, skipped: false };
}
