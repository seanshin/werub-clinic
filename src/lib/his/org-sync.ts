// Created: 2026-07-17 14:20
// HIS 조직도 동기화 v2 파이프라인 공용 모듈 — organization/sync(병원 카페)와
// channel-workspace/org-sync(W.Channel 워크스페이스)가 동일 staff[] 스키마로 공유.
// 처리: 식별(clinicUserId→email→autoCreate) → cafe_members + wsign_members upsert →
//       his_role_mappings(사번/재직상태/입사일) → 2패스 보고라인(managerEmployeeNumber→reportsTo).
// 부가: buildDeptOrgTree(부서 트리 자동 생성 — org-chart UI는 부서 노드만 소비, 멤버는 wsign_members.dept 매칭),
//       updateDeptHeads(하위 보고자 보유 + 매니저가 타부서/없음 → is_dept_head).
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export interface HisStaffItem {
  employeeNumber?: string | null;
  email?: string | null;
  clinicUserId?: string | null;
  name?: string | null;
  department?: string | null;
  position?: string | null;
  status?: string | null;
  hireDate?: string | null;
  managerEmployeeNumber?: string | null;
  hisRole?: string | null;
}

export interface StaffSyncResult {
  created: number;
  updated: number;
  skipped: number;
  reportingLines: number;
  mappings: Array<{ employeeNumber: string | null; email: string | null; clinicUserId: string }>;
  errors: Array<{ employeeNumber?: string | null; email?: string | null; reason: string }>;
}

const STATUS_ALIAS: Record<string, string> = {
  active: "active", "재직": "active", employed: "active",
  on_leave: "on_leave", leave: "on_leave", "휴직": "on_leave",
  resigned: "resigned", retired: "resigned", "퇴직": "resigned", terminated: "resigned",
};
export const normStatus = (s?: string | null) => STATUS_ALIAS[(s ?? "active").toLowerCase()] ?? "active";

/** staff[] 배치를 대상 카페에 동기화 (멱등 upsert). autoCreate=신규 계정 생성(비밀번호 없음).
 *  perf(2026-07-21): staff당 5~7쿼리 루프 → 세트 기반(식별2+계정1+멤버3+보고2). 1000명 재싱크 타임아웃 제거. 시맨틱(C1/M8/D1/M1) 보존. */
export async function syncStaffToCafe(cafeId: string, staff: HisStaffItem[], opts: { autoCreate: boolean }): Promise<StaffSyncResult> {
  const mappings: StaffSyncResult["mappings"] = [];
  const errors: StaffSyncResult["errors"] = [];
  const empNoToUserId = new Map<string, string>();
  let created = 0, updated = 0, skipped = 0;

  // ── 0. 식별(2쿼리): clinicUserId·email 일괄 조회 ──
  const clinicIds = [...new Set(staff.map((s) => s.clinicUserId).filter(Boolean) as string[])];
  const emails = [...new Set(staff.map((s) => s.email?.toLowerCase()).filter(Boolean) as string[])];
  const idHit = new Set<string>(clinicIds.length ? (await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ANY(${clinicIds}::text[])`).map((r) => r.id) : []);
  const emailToId = new Map<string, string>();
  if (emails.length) for (const r of await prisma.$queryRaw<{ id: string; email: string }[]>`SELECT id, lower(email) AS email FROM users WHERE lower(email) = ANY(${emails}::text[])`) emailToId.set(r.email, r.id);

  // 각 staff의 userId 확정 or 생성 대기 목록
  type Row = { s: HisStaffItem; userId: string };
  const resolved: Row[] = [];
  const toCreate: { s: HisStaffItem; userId: string; username: string }[] = [];
  const takenBases = new Map<string, number>(); // 이번 배치 내 username 충돌 카운터
  for (const s of staff) {
    if (!s.clinicUserId && !s.email) { errors.push({ employeeNumber: s.employeeNumber, reason: "clinicUserId 또는 email 필요" }); skipped++; continue; }
    let userId: string | null = null;
    if (s.clinicUserId && idHit.has(s.clinicUserId)) userId = s.clinicUserId;
    if (!userId && s.email) userId = emailToId.get(s.email.toLowerCase()) ?? null;
    if (userId) { resolved.push({ s, userId }); updated++; continue; }
    if (!opts.autoCreate || !s.email) { errors.push({ employeeNumber: s.employeeNumber, email: s.email, reason: opts.autoCreate ? "email 없이 신규 생성 불가" : "미존재 (autoCreate=false)" }); skipped++; continue; }
    const base = ((s.name ?? s.email.split("@")[0]).replace(/\s+/g, "").slice(0, 20) || "his-staff");
    const n = takenBases.get(base) ?? 0; takenBases.set(base, n + 1);
    const uid = crypto.randomUUID();
    toCreate.push({ s, userId: uid, username: base }); // 최종 username은 아래서 기존 충돌 반영
    resolved.push({ s, userId: uid });
  }

  // ── 1. 신규 계정 생성(username 충돌 해소 후 unnest INSERT) ──
  if (toCreate.length) {
    const bases = [...new Set(toCreate.map((c) => c.username))];
    const taken = new Set<string>((await prisma.$queryRaw<{ username: string }[]>`SELECT username FROM users WHERE username = ANY(${bases}::text[])`).map((r) => r.username));
    const localCount = new Map<string, number>();
    for (const c of toCreate) {
      let uname = c.username;
      const seen = localCount.get(c.username) ?? 0; localCount.set(c.username, seen + 1);
      if (taken.has(uname) || seen > 0) uname = `${c.username}_${crypto.randomUUID().slice(0, 4)}`;
      c.username = uname; taken.add(uname);
    }
    // email_verified=false: HIS가 이메일을 주장해도 소유권 미검증 — 실소유자는 재설정/SSO 흐름에서 검증(보안 F5, 이메일 선점 차단)
    await prisma.$executeRaw`INSERT INTO users (id, email, username, role, email_verified, join_type, created_at, updated_at)
       SELECT t.id, t.email, t.uname, 'MEMBER', false, 'INVITED', now(), now()
       FROM unnest(${toCreate.map((c) => c.userId)}::text[], ${toCreate.map((c) => c.s.email!.toLowerCase())}::text[], ${toCreate.map((c) => c.username)}::text[]) AS t(id, email, uname)`;
    created = toCreate.length;
  }

  // resolved 기준 배열 구성
  for (const r of resolved) {
    if (r.s.employeeNumber) empNoToUserId.set(r.s.employeeNumber, r.userId);
    mappings.push({ employeeNumber: r.s.employeeNumber ?? null, email: r.s.email?.toLowerCase() ?? null, clinicUserId: r.userId });
  }
  const uids = resolved.map((r) => r.userId);
  const cmStatuses = resolved.map((r) => (normStatus(r.s.status) !== "resigned" ? "ACTIVE" : "BANNED"));
  const actives = resolved.map((r) => normStatus(r.s.status) !== "resigned");
  const dns = resolved.map((r) => r.s.name ?? "");
  const depts = resolved.map((r) => r.s.department ?? "");
  const poss = resolved.map((r) => r.s.position ?? "");
  const hisRoles = resolved.map((r) => r.s.hisRole ?? "Staff");
  const deptNs = resolved.map((r) => r.s.department ?? "");
  const metas = resolved.map((r) => JSON.stringify({ position: r.s.position ?? null, employeeNumber: r.s.employeeNumber ?? null, status: normStatus(r.s.status), hireDate: r.s.hireDate ?? null, source: "his_org_sync_v2" }));

  // ── 2. 멤버 3종 세트 upsert ──
  if (uids.length) {
    await prisma.$executeRaw`INSERT INTO cafe_members (id, cafe_id, user_id, role, status, joined_at)
       SELECT gen_random_uuid()::text, ${cafeId}, t.u, 'REGULAR', t.st::"CafeMemberStatus", now()
       FROM unnest(${uids}::text[], ${cmStatuses}::text[]) AS t(u, st)
       ON CONFLICT (cafe_id, user_id) DO UPDATE
         SET status = CASE WHEN cafe_members.role IN ('OWNER','MANAGER') THEN cafe_members.status ELSE EXCLUDED.status END`;
    // wsign: dept/직함 빈 값이면 기존 보존(D1), active 반영(C1)
    await prisma.$executeRaw`INSERT INTO wsign_members (id, cafe_id, user_id, wsign_role, display_name, dept, job_title, active, created_at)
       SELECT gen_random_uuid()::text, ${cafeId}, t.u, 'drafter', t.dn, t.dept, t.pos, t.act, now()
       FROM unnest(${uids}::text[], ${dns}::text[], ${depts}::text[], ${poss}::text[], ${actives}::boolean[]) AS t(u, dn, dept, pos, act)
       ON CONFLICT (cafe_id, user_id) DO UPDATE SET
         dept = CASE WHEN EXCLUDED.dept <> '' THEN EXCLUDED.dept ELSE wsign_members.dept END,
         job_title = CASE WHEN EXCLUDED.job_title <> '' THEN EXCLUDED.job_title ELSE wsign_members.job_title END,
         active = EXCLUDED.active`;
    // his_role_mappings: metadata 병합(기존 reportsTo 등 보존 — 보고라인은 아래서 갱신)
    await prisma.$executeRaw`INSERT INTO his_role_mappings (id, cafe_id, user_id, his_role, department, metadata, updated_at)
       SELECT gen_random_uuid()::text, ${cafeId}, t.u, t.role, NULLIF(t.dept, ''), t.meta::jsonb, now()
       FROM unnest(${uids}::text[], ${hisRoles}::text[], ${deptNs}::text[], ${metas}::text[]) AS t(u, role, dept, meta)
       ON CONFLICT (cafe_id, user_id) DO UPDATE SET
         his_role = EXCLUDED.his_role, department = EXCLUDED.department,
         metadata = COALESCE(his_role_mappings.metadata, '{}'::jsonb) || EXCLUDED.metadata, updated_at = now()`;
  }

  // ── 3. 보고라인(2 세트 UPDATE): 유효 관리자 있으면 reportsTo 설정, 없으면 제거(M1) ──
  let reportingLines = 0;
  const mgrEmpNos = [...new Set(staff.map((s) => s.managerEmployeeNumber).filter(Boolean) as string[])];
  const empNoToExisting = new Map<string, string>();
  if (mgrEmpNos.length) for (const r of await prisma.$queryRaw<{ emp: string; user_id: string }[]>`SELECT metadata->>'employeeNumber' AS emp, user_id FROM his_role_mappings WHERE cafe_id = ${cafeId} AND metadata->>'employeeNumber' = ANY(${mgrEmpNos}::text[])`) empNoToExisting.set(r.emp, r.user_id);
  const setPairs: [string, string][] = [];  // [selfId, mgrId]
  const clearIds: string[] = [];
  for (const r of resolved) {
    const s = r.s;
    if (!s.employeeNumber) continue;
    let mgrId: string | null = null;
    if (s.managerEmployeeNumber) mgrId = empNoToUserId.get(s.managerEmployeeNumber) ?? empNoToExisting.get(s.managerEmployeeNumber) ?? null;
    if (mgrId && mgrId !== r.userId) { setPairs.push([r.userId, mgrId]); reportingLines++; }
    else clearIds.push(r.userId);
  }
  if (setPairs.length) {
    await prisma.$executeRaw`UPDATE his_role_mappings h SET metadata = h.metadata || jsonb_build_object('reportsTo', t.mgr), updated_at = now()
       FROM unnest(${setPairs.map((p) => p[0])}::text[], ${setPairs.map((p) => p[1])}::text[]) AS t(self, mgr)
       WHERE h.cafe_id = ${cafeId} AND h.user_id = t.self`;
  }
  if (clearIds.length) {
    await prisma.$executeRaw`UPDATE his_role_mappings SET metadata = metadata - 'reportsTo', updated_at = now()
       WHERE cafe_id = ${cafeId} AND user_id = ANY(${clearIds}::text[]) AND metadata ? 'reportsTo'`;
  }

  return { created, updated, skipped, reportingLines, mappings, errors };
}

type OrgNode = { id: string; name: string; children: OrgNode[] };
const deptId = (name: string) => `dept-his-${Buffer.from(name).toString("hex").slice(0, 24)}`;

/** 부서 계층 트리 자동 생성 → WsignOrgTree upsert.
 *  계층 추론: 각 부서 멤버들의 보고라인(reportsTo)이 가리키는 "타 부서" 다수결 = 상위 부서.
 *  (부서장이 상위 부서장에게 보고하는 관계로 부서 상하 형성.) 순환은 조상 체인 검사로 차단.
 *  org-chart UI는 부서 노드 name으로 멤버(wsign_members.dept) 매칭. */
export async function rebuildDeptOrgTree(cafeId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ user_id: string; department: string | null; reports_to: string | null }[]>`
    SELECT user_id, department, metadata->>'reportsTo' AS reports_to FROM his_role_mappings
    WHERE cafe_id = ${cafeId} AND department IS NOT NULL AND department != ''
      AND COALESCE(metadata->>'status', 'active') != 'resigned'
    ORDER BY user_id`;
  const deptOf = new Map(rows.map((r) => [r.user_id, r.department!]));
  const depts = [...new Set(rows.map((r) => r.department!).filter(Boolean))].sort();

  // 부서 → 상위 부서 다수결 투표
  const votes = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.department || !r.reports_to) continue;
    const mgrDept = deptOf.get(r.reports_to);
    if (!mgrDept || mgrDept === r.department) continue; // 같은 부서 내 보고 제외
    if (!votes.has(r.department)) votes.set(r.department, new Map());
    const v = votes.get(r.department)!;
    v.set(mgrDept, (v.get(mgrDept) ?? 0) + 1);
  }
  const parent = new Map<string, string>();
  for (const [dept, v] of votes) {
    // 결정적 타이브레이크: 득표 내림차순 → 이름 오름차순 (동일 싱크 재실행 시 부모 고정, 멱등성 M2)
    const top = [...v.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top) parent.set(dept, top[0]);
  }
  // 순환 차단: 부모 체인에 자기 자신이 나오면 그 부서를 루트로 승격
  const isAncestor = (dept: string, maybeAncestor: string): boolean => {
    let cur = parent.get(dept), guard = 0;
    while (cur && guard++ < 100) { if (cur === maybeAncestor) return true; cur = parent.get(cur); }
    return false;
  };
  for (const [dept, par] of [...parent.entries()]) {
    if (dept === par || isAncestor(par, dept)) parent.delete(dept);
  }

  // 자식 목록
  const childrenOf = new Map<string, string[]>();
  for (const d of depts) {
    const par = parent.get(d);
    if (par && depts.includes(par)) { (childrenOf.get(par) ?? childrenOf.set(par, []).get(par)!).push(d); }
  }
  const roots = depts.filter((d) => !parent.has(d) || !depts.includes(parent.get(d)!));

  // 캡을 실질 무제한(500)으로 — 초과 시 재편입(아래)이 유실은 막지만 계층 평탄화 방지(LOW-9). 병원 부서는 통상 수십.
  const build = (name: string, seen: Set<string>): OrgNode => {
    seen.add(name);
    const kids = (childrenOf.get(name) ?? []).filter((c) => !seen.has(c)).slice(0, 500);
    return { id: deptId(name), name, children: kids.map((c) => build(c, seen)) };
  };
  const seen = new Set<string>();
  const tree: OrgNode = { id: "org-root", name: "조직도", children: roots.slice(0, 500).map((r) => build(r, seen)) };
  // 혹시 누락된 부서(순환 등)는 최상위로 편입
  for (const d of depts) if (!seen.has(d)) tree.children.push(build(d, seen));

  await prisma.wsignOrgTree.upsert({
    where: { cafeId },
    create: { cafeId, treeJson: tree as unknown as object },
    update: { treeJson: tree as unknown as object },
  });
  return depts.length;
}

/** 부서장 판정: 수동 지정(metadata.deptHead=manual_on/off) 우선, 없으면 자동(하위 보고자 보유 + 매니저 없음/타부서) → wsign_members.is_dept_head */
export async function updateDeptHeads(cafeId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ user_id: string; department: string | null; reports_to: string | null; manual: string | null }[]>`
    SELECT user_id, department, metadata->>'reportsTo' AS reports_to, metadata->>'deptHead' AS manual FROM his_role_mappings
    WHERE cafe_id = ${cafeId} AND COALESCE(metadata->>'status', 'active') != 'resigned'`;
  const byId = new Map(rows.map((r) => [r.user_id, r]));
  const hasReports = new Set(rows.map((r) => r.reports_to).filter(Boolean) as string[]);
  const heads = rows.filter((r) => {
    // 수동 지정이 자동 계산을 이긴다 — 관리자가 조직도 UI에서 직접 지정/해제한 부서장 유지
    if (r.manual === "manual_on") return true;
    if (r.manual === "manual_off") return false;
    if (!hasReports.has(r.user_id)) return false;
    const mgr = r.reports_to ? byId.get(r.reports_to) : null;
    return !mgr || (mgr.department ?? "") !== (r.department ?? "");
  }).map((r) => r.user_id);

  // 최종 부서장 집합 기준으로 일괄 설정(트랜잭션) — 리셋 후 재설정을 별도 UPDATE 2회로 원자화(M9)
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE wsign_members SET is_dept_head = true WHERE cafe_id = ${cafeId} AND user_id = ANY(${heads}::text[])`,
    prisma.$executeRaw`UPDATE wsign_members SET is_dept_head = false WHERE cafe_id = ${cafeId} AND NOT (user_id = ANY(${heads}::text[]))`,
  ]);
  return heads.length;
}

/** 병원 카페의 현재 조직(wsign_members + his_role_mappings)을 채널 워크스페이스로 복제 후 트리 재생성.
 *  UI/관리자 트리거용 — HIS staff[] push 없이 병원의 기존 조직을 채널에 즉시 반영. 멱등. */
export async function syncHospitalOrgToChannel(hospitalCafeId: string, channelCafeId: string): Promise<{ members: number; depts: number; deptHeads: number }> {
  // perf(2026-07-21): 멤버당 3쿼리 루프(92명≈280 RT, ~1-2s) → 세트 기반 4쿼리(INSERT…SELECT). 채널 role은 보존(DO UPDATE에 role 없음).
  const cnt = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM wsign_members WHERE cafe_id = ${hospitalCafeId}`;
  await prisma.$executeRaw`INSERT INTO cafe_members (id, cafe_id, user_id, role, status, joined_at)
     SELECT gen_random_uuid()::text, ${channelCafeId}, wm.user_id, 'REGULAR',
            (CASE WHEN wm.active THEN 'ACTIVE' ELSE 'BANNED' END)::"CafeMemberStatus", now()
     FROM wsign_members wm WHERE wm.cafe_id = ${hospitalCafeId}
     ON CONFLICT (cafe_id, user_id) DO UPDATE SET status = EXCLUDED.status`;
  await prisma.$executeRaw`INSERT INTO wsign_members (id, cafe_id, user_id, wsign_role, display_name, dept, job_title, is_dept_head, active, created_at)
     SELECT gen_random_uuid()::text, ${channelCafeId}, wm.user_id, 'drafter', wm.display_name, wm.dept, wm.job_title, wm.is_dept_head, wm.active, now()
     FROM wsign_members wm WHERE wm.cafe_id = ${hospitalCafeId}
     ON CONFLICT (cafe_id, user_id) DO UPDATE SET dept = EXCLUDED.dept, job_title = EXCLUDED.job_title, is_dept_head = EXCLUDED.is_dept_head, active = EXCLUDED.active`;
  await prisma.$executeRaw`INSERT INTO his_role_mappings (id, cafe_id, user_id, his_role, department, metadata, updated_at)
     SELECT gen_random_uuid()::text, ${channelCafeId}, rm.user_id, rm.his_role, rm.department, rm.metadata, now()
     FROM his_role_mappings rm
     JOIN wsign_members wm ON wm.cafe_id = ${hospitalCafeId} AND wm.user_id = rm.user_id
     WHERE rm.cafe_id = ${hospitalCafeId}
     ON CONFLICT (cafe_id, user_id) DO UPDATE SET his_role = EXCLUDED.his_role, department = EXCLUDED.department,
       -- 병합(형제 syncStaffToCafe와 동일): 통째 교체하면 채널에서 지정한 부서장(metadata.deptHead=manual_on)이
       -- 사라지고, 직후 updateDeptHeads가 그 metadata로 재계산해 부서장 지정이 조용히 소멸한다.
       -- 병원 쪽 키가 있으면 병원이 이기고, 없을 때만 채널의 로컬 지정이 살아남는다.
       metadata = COALESCE(his_role_mappings.metadata, '{}'::jsonb) || EXCLUDED.metadata, updated_at = now()`;
  const src = { length: cnt[0]?.n ?? 0 };
  const depts = await rebuildDeptOrgTree(channelCafeId);
  const deptHeads = await updateDeptHeads(channelCafeId);
  await joinActiveMembersToPublicChannels(channelCafeId);
  return { members: src.length, depts, deptHeads };
}

// (구 propagateHospitalRoleToChannel 제거 — 채널 권한은 채널 카페 멤버 관리에서 직접 지정, 사용자 결정 2026-07-21.
//  자동 전파는 채널측 직접 지정을 병원 role 변경이 덮어쓰는 충돌이 있었음.)

/** 워크스페이스 활성 멤버 전원을 공개 채널에 참여시킴(멱등) — 기본 채널이 빈 목록으로 보이는 문제 해소. */
export async function joinActiveMembersToPublicChannels(channelCafeId: string): Promise<number> {
  const r = await prisma.$executeRaw`
    INSERT INTO board_channel_members (channel_id, user_id, invited_by, joined_at)
    SELECT bc.id, cm.user_id, cm.user_id, now()
    FROM board_channels bc
    JOIN cafe_members cm ON cm.cafe_id = bc.cafe_id AND cm.status = 'ACTIVE'
    WHERE bc.cafe_id = ${channelCafeId} AND bc.is_private = false AND bc.is_active = true
    ON CONFLICT (channel_id, user_id) DO NOTHING`;
  return Number(r);
}

/** 엔터프라이즈(company/org) 조직을 채널 워크스페이스로 복제 — 병원 경로(syncHospitalOrgToChannel)와 형제.
 *  his_role_mappings가 없으므로: cafe_members+wsign_members 세트 복제 + 소스 wsign_org_trees 트리 그대로 복제.
 *  (병원처럼 rebuildDeptOrgTree/updateDeptHeads를 돌리면 HIS 매핑 부재로 부서장이 전부 초기화됨 — 호출 금지) */
export async function syncOrgToChannel(sourceCafeId: string, channelCafeId: string): Promise<{ members: number; depts: number; deptHeads: number }> {
  const cnt = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM wsign_members WHERE cafe_id = ${sourceCafeId}`;
  await prisma.$executeRaw`INSERT INTO cafe_members (id, cafe_id, user_id, role, status, joined_at)
     SELECT gen_random_uuid()::text, ${channelCafeId}, wm.user_id, 'REGULAR',
            (CASE WHEN wm.active THEN 'ACTIVE' ELSE 'BANNED' END)::"CafeMemberStatus", now()
     FROM wsign_members wm WHERE wm.cafe_id = ${sourceCafeId}
     ON CONFLICT (cafe_id, user_id) DO UPDATE SET status = EXCLUDED.status`;
  await prisma.$executeRaw`INSERT INTO wsign_members (id, cafe_id, user_id, wsign_role, display_name, dept, job_title, is_dept_head, active, created_at)
     SELECT gen_random_uuid()::text, ${channelCafeId}, wm.user_id, 'drafter', wm.display_name, wm.dept, wm.job_title, wm.is_dept_head, wm.active, now()
     FROM wsign_members wm WHERE wm.cafe_id = ${sourceCafeId}
     ON CONFLICT (cafe_id, user_id) DO UPDATE SET dept = EXCLUDED.dept, job_title = EXCLUDED.job_title, is_dept_head = EXCLUDED.is_dept_head, active = EXCLUDED.active`;

  // 소스 조직 트리 복제 (있을 때만) — 채널측 트리를 소스 정본으로 동기화
  let depts = 0;
  const tree = await prisma.wsignOrgTree.findUnique({ where: { cafeId: sourceCafeId }, select: { treeJson: true } });
  if (tree?.treeJson) {
    await prisma.wsignOrgTree.upsert({
      where: { cafeId: channelCafeId },
      create: { cafeId: channelCafeId, treeJson: tree.treeJson as object },
      update: { treeJson: tree.treeJson as object },
    });
    const countDepts = (node: unknown): number => {
      if (!node || typeof node !== "object") return 0;
      const children = (node as { children?: unknown[] }).children ?? [];
      return children.length + children.reduce((sum: number, c) => sum + countDepts(c), 0);
    };
    depts = countDepts(tree.treeJson);
  }

  const deptHeads = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM wsign_members WHERE cafe_id = ${channelCafeId} AND is_dept_head = true`;
  await joinActiveMembersToPublicChannels(channelCafeId);
  return { members: cnt[0]?.n ?? 0, depts, deptHeads: deptHeads[0]?.n ?? 0 };
}

/** 입사자 증분 싱크 (W1): 소스 카페 가입 승인 시 해당 멤버만 연동 워크스페이스에 추가(전체 싱크 불필요).
 *  sync_org=true 링크 대상. 실패 무해(fire-and-forget 용). */
export async function addMemberToLinkedWorkspaces(sourceCafeId: string, userId: string): Promise<void> {
  try {
    const links = await prisma.$queryRaw<{ channel_cafe_id: string }[]>`
      SELECT DISTINCT l.channel_cafe_id FROM (
        SELECT channel_cafe_id FROM wsign_workspace_links WHERE source_cafe_id = ${sourceCafeId} AND active = true AND sync_org = true
        UNION
        SELECT channel_cafe_id FROM his_channel_links WHERE hospital_cafe_id = ${sourceCafeId} AND active = true
      ) l
      JOIN cafes c ON c.id = l.channel_cafe_id AND (c.source = 'wchannel' OR c.cafe_type = 'channel')`;
    for (const link of links) {
      await prisma.$executeRaw`INSERT INTO cafe_members (id, cafe_id, user_id, role, status, joined_at)
         VALUES (gen_random_uuid()::text, ${link.channel_cafe_id}, ${userId}, 'REGULAR', 'ACTIVE'::"CafeMemberStatus", now())
         ON CONFLICT (cafe_id, user_id) DO UPDATE SET status = 'ACTIVE'::"CafeMemberStatus"`;
      await prisma.$executeRaw`INSERT INTO wsign_members (id, cafe_id, user_id, wsign_role, display_name, dept, job_title, is_dept_head, active, created_at)
         SELECT gen_random_uuid()::text, ${link.channel_cafe_id}, wm.user_id, 'drafter', wm.display_name, wm.dept, wm.job_title, wm.is_dept_head, wm.active, now()
         FROM wsign_members wm WHERE wm.cafe_id = ${sourceCafeId} AND wm.user_id = ${userId}
         ON CONFLICT (cafe_id, user_id) DO UPDATE SET active = true`;
      // 공개 채널 참여 (해당 멤버만)
      await prisma.$executeRaw`INSERT INTO board_channel_members (channel_id, user_id, invited_by, joined_at)
         SELECT bc.id, ${userId}, ${userId}, now()
         FROM board_channels bc
         WHERE bc.cafe_id = ${link.channel_cafe_id} AND bc.is_private = false AND bc.is_active = true
         ON CONFLICT (channel_id, user_id) DO NOTHING`;
    }
  } catch { /* 링크/테이블 미존재 — non-fatal */ }
}

/** 퇴사자 동기 (W2): 소스 카페(병원/기업)에서 멤버 차단·탈퇴 시 연결된 채널 워크스페이스에서도 비활성.
 *  active=true로 호출하면 차단 해제 시 재활성. 링크 없으면 no-op, 실패 무해(fire-and-forget 용). */
export async function setMemberActiveInLinkedWorkspaces(sourceCafeId: string, userId: string, active: boolean): Promise<void> {
  try {
    const links = await prisma.$queryRaw<{ channel_cafe_id: string }[]>`
      SELECT DISTINCT l.channel_cafe_id FROM (
        SELECT channel_cafe_id FROM wsign_workspace_links WHERE source_cafe_id = ${sourceCafeId} AND active = true
        UNION
        SELECT channel_cafe_id FROM his_channel_links WHERE hospital_cafe_id = ${sourceCafeId} AND active = true
      ) l
      JOIN cafes c ON c.id = l.channel_cafe_id AND c.source = 'wchannel'`;
    for (const link of links) {
      if (active) {
        await prisma.$executeRaw`UPDATE cafe_members SET status = 'ACTIVE'::"CafeMemberStatus" WHERE cafe_id = ${link.channel_cafe_id} AND user_id = ${userId} AND status = 'BANNED'`;
        await prisma.$executeRaw`UPDATE wsign_members SET active = true WHERE cafe_id = ${link.channel_cafe_id} AND user_id = ${userId}`;
      } else {
        await prisma.$executeRaw`UPDATE cafe_members SET status = 'BANNED'::"CafeMemberStatus" WHERE cafe_id = ${link.channel_cafe_id} AND user_id = ${userId} AND status = 'ACTIVE'`;
        await prisma.$executeRaw`UPDATE wsign_members SET active = false WHERE cafe_id = ${link.channel_cafe_id} AND user_id = ${userId}`;
      }
    }
  } catch { /* 링크/테이블 미존재 — non-fatal */ }
}

/** 조직 정보(부서·직위·부서장·표시명) 변경을 연동 워크스페이스에 전파.
 *  기존에는 전체 싱크를 수동으로 돌려야만 반영돼, 회사에서 부서를 바꿔도 채널 조직도는 옛 값이 남았다.
 *  대상이 아직 채널에 없으면 추가까지 한다(누락 방지). 실패 무해(fire-and-forget). */
export async function syncMemberInfoToLinkedWorkspaces(sourceCafeId: string, userId: string): Promise<void> {
  try {
    const links = await prisma.$queryRaw<{ channel_cafe_id: string }[]>`
      SELECT DISTINCT l.channel_cafe_id FROM (
        SELECT channel_cafe_id FROM wsign_workspace_links WHERE source_cafe_id = ${sourceCafeId} AND active = true AND sync_org = true
        UNION
        SELECT channel_cafe_id FROM his_channel_links WHERE hospital_cafe_id = ${sourceCafeId} AND active = true
      ) l
      JOIN cafes c ON c.id = l.channel_cafe_id AND (c.source = 'wchannel' OR c.cafe_type = 'channel')`;
    for (const link of links) {
      await prisma.$executeRaw`
        INSERT INTO wsign_members (id, cafe_id, user_id, wsign_role, display_name, dept, job_title, is_dept_head, active, created_at)
        SELECT gen_random_uuid()::text, ${link.channel_cafe_id}, wm.user_id, 'drafter',
               wm.display_name, wm.dept, wm.job_title, wm.is_dept_head, wm.active, now()
        FROM wsign_members wm WHERE wm.cafe_id = ${sourceCafeId} AND wm.user_id = ${userId}
        ON CONFLICT (cafe_id, user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name, dept = EXCLUDED.dept, job_title = EXCLUDED.job_title,
          is_dept_head = EXCLUDED.is_dept_head, active = EXCLUDED.active`;
    }
  } catch { /* 링크/테이블 미존재 — non-fatal */ }
}

/** 활성 엔터프라이즈↔채널 워크스페이스 링크 조회 (wsign_workspace_links 기반) */
export async function getActiveWorkspaceLink(sourceCafeId: string): Promise<{ channelCafeId: string; linkId: string } | null> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; channel_cafe_id: string }[]>`
      SELECT l.id, l.channel_cafe_id FROM wsign_workspace_links l
      JOIN cafes c ON c.id = l.channel_cafe_id
      WHERE l.source_cafe_id = ${sourceCafeId} AND l.active = true
        AND (c.source = 'wchannel' OR c.cafe_type = 'channel') LIMIT 1`;
    return rows[0] ? { channelCafeId: rows[0].channel_cafe_id, linkId: rows[0].id } : null;
  } catch {
    return null;
  }
}

/** 활성 HIS↔채널 워크스페이스 링크 조회 */
export async function getActiveChannelLink(hospitalCafeId: string): Promise<{ channelCafeId: string; linkId: string } | null> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; channel_cafe_id: string }[]>`
      SELECT id, channel_cafe_id FROM his_channel_links WHERE hospital_cafe_id = ${hospitalCafeId} AND active = true LIMIT 1`;
    return rows[0] ? { channelCafeId: rows[0].channel_cafe_id, linkId: rows[0].id } : null;
  } catch {
    return null; // 테이블 미존재(마이그레이션 전) = 링크 없음
  }
}
