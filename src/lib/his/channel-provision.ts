// Created: 2026-07-21
// W.Channel 워크스페이스 프로비저닝 공용 — HIS 키 경로(clinic/his/channel-workspace)와
// 관리자 세션 경로(cafes/[slug]/channel-workspace, 병원 워크그룹 관리 UI)가 공유.
import { prisma } from "@/lib/prisma";
import { pool } from "@/lib/pg-pool";
import { uniqueSlug } from "@/lib/utils";

export const CHANNEL_HOST = process.env.NEXT_PUBLIC_CHANNEL_APP_URL || "https://channel.example.org";

const CAFE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
async function generateCafeCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = Array.from({ length: 6 }, () => CAFE_CODE_CHARS[Math.floor(Math.random() * CAFE_CODE_CHARS.length)]).join("");
    const { rows } = await pool.query(`SELECT id FROM cafes WHERE cafe_code=$1`, [code]);
    if (rows.length === 0) return code;
  }
  return Date.now().toString(36).toUpperCase().slice(-6);
}

export interface ChannelLinkStatus {
  linkId: string; active: boolean; workspaceSlug: string; workspaceName: string; url: string; createdAt: Date;
}

/** 승인된 병원(cafe_status='active')만 프로비저닝 가능 — 미승인/정지 시 throw(보안 D1).
 *  승인 워크플로우 정본 = cafes.cafe_status + /admin/hospitals(pending_approval→active). */
export async function assertHospitalApproved(hospitalCafeId: string): Promise<void> {
  const rows = await pool.query(`SELECT cafe_status FROM cafes WHERE id = $1`, [hospitalCafeId]);
  const status = rows.rows[0]?.cafe_status;
  if (status !== "active") {
    const { ForbiddenError } = await import("@/lib/errors");
    throw new ForbiddenError("플랫폼 관리자 승인(활성) 후 채널 워크스페이스를 생성할 수 있습니다");
  }
}

/** 병원↔채널 워크스페이스 링크 현황 (최신 1건) */
export async function getChannelLinkStatus(hospitalCafeId: string): Promise<ChannelLinkStatus | null> {
  const rows = await pool.query(
    `SELECT l.id, l.channel_cafe_id, l.active, l.created_at, c.slug, c.name
     FROM his_channel_links l JOIN cafes c ON c.id = l.channel_cafe_id
     WHERE l.hospital_cafe_id = $1 ORDER BY l.created_at DESC LIMIT 1`, [hospitalCafeId]);
  const r = rows.rows[0];
  if (!r) return null;
  return { linkId: r.id, active: r.active, workspaceSlug: r.slug, workspaceName: r.name, url: `${CHANNEL_HOST}/${r.slug}`, createdAt: r.created_at };
}

export interface ProvisionOpts {
  hospitalCafeId: string;
  hospitalCafeName: string;
  hospitalCode: string;
  ownerId: string;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
}

/** 워크스페이스 생성 (병원당 1개, 멱등). 활성 링크 있으면 기존 반환. */
export async function provisionChannelWorkspace(opts: ProvisionOpts): Promise<{ workspace: { workspaceSlug: string; workspaceName: string; url: string; plan: string }; idempotent: boolean }> {
  const existing = await getChannelLinkStatus(opts.hospitalCafeId);
  if (existing?.active) {
    return { workspace: { workspaceSlug: existing.workspaceSlug, workspaceName: existing.workspaceName, url: existing.url, plan: "clinic" }, idempotent: true };
  }
  await assertHospitalApproved(opts.hospitalCafeId); // 보안 D1: 승인된 병원만 신규 프로비저닝

  const name = opts.name?.trim() || `${opts.hospitalCafeName} 채널`;
  const baseSlug = opts.slug ? (opts.slug.startsWith("wc-") ? opts.slug : `wc-${opts.slug}`) : `wc-${opts.hospitalCode.toLowerCase()}`;
  const slug = await uniqueSlug(baseSlug, async (s) => !!(await prisma.cafe.findUnique({ where: { slug: s }, select: { id: true } })));

  const cafe = await prisma.cafe.create({
    data: {
      name, slug,
      description: opts.description ?? `${opts.hospitalCafeName} HIS 연동 워크스페이스`,
      visibility: "PRIVATE",
      ownerId: opts.ownerId,
      boardEnabled: true,
      wsignEnabled: true,
      manageEnabled: true,
      members: { create: { userId: opts.ownerId, role: "OWNER", status: "ACTIVE" } },
    },
    select: { id: true, slug: true, name: true },
  });

  const cafeCode = await generateCafeCode();
  await pool.query(`UPDATE cafes SET cafe_code=$1, cafe_type='organization', source='wchannel' WHERE id=$2`, [cafeCode, cafe.id]);
  await pool.query(`INSERT INTO workspace_subscriptions (cafe_id, plan, status) VALUES ($1, 'clinic', 'active') ON CONFLICT DO NOTHING`, [cafe.id]);

  const notice = await prisma.boardChannel.create({
    data: { cafeId: cafe.id, name: "공지", description: "병원 공지 · 결재 알림", isPrivate: false, createdBy: opts.ownerId, sortOrder: 0 },
    select: { id: true },
  });
  await prisma.boardChannel.create({
    data: { cafeId: cafe.id, name: "일반", description: "자유 대화", isPrivate: false, createdBy: opts.ownerId, sortOrder: 1 },
  }).catch(() => {});

  // 워크스페이스 멤버(현재는 소유자)를 공개 채널에 참여시킴 — 이후 조직 싱크가 나머지 참여 (빈 채널 목록 방지)
  try {
    const { joinActiveMembersToPublicChannels } = await import("@/lib/his/org-sync");
    await joinActiveMembersToPublicChannels(cafe.id);
  } catch { /* non-fatal */ }

  await pool.query(
    `INSERT INTO his_channel_links (id, hospital_cafe_id, channel_cafe_id, active, created_by)
     VALUES (gen_random_uuid()::text, $1, $2, true, $3)`, [opts.hospitalCafeId, cafe.id, opts.ownerId]);
  try {
    await pool.query(
      `INSERT INTO wsign_workspace_links (id, source_cafe_id, channel_cafe_id, default_channel_id, notify_mode, sync_org, mask_amount, created_by, active)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'mention', true, true, $4, true)
       ON CONFLICT (source_cafe_id, channel_cafe_id) DO UPDATE SET active = true, sync_org = true, default_channel_id = EXCLUDED.default_channel_id`,
      [opts.hospitalCafeId, cafe.id, notice.id, opts.ownerId]);
  } catch (e) {
    const { logger } = await import("@/lib/logger");
    logger.warn("HIS_API_ERROR", "wsign 워크스페이스 링크 생성 실패", { channelCafeId: cafe.id, error: (e as Error).message });
  }

  // 병원 cafe 온보딩 시드 (문서함 카테고리+결재라인+템플릿 기본결재선). 멱등·실패 무해.
  try {
    const hc = await prisma.cafe.findUnique({ where: { id: opts.hospitalCafeId }, select: { cafeType: true } });
    const { seedClinicDocCategories, seedClinicApprovalLines, linkClinicTemplateDefaultLines } = await import("@/lib/wsign/clinic-doc-categories");
    await seedClinicDocCategories(opts.hospitalCafeId, hc?.cafeType);
    await seedClinicApprovalLines(opts.hospitalCafeId, hc?.cafeType);
    await linkClinicTemplateDefaultLines(opts.hospitalCafeId, hc?.cafeType);
  } catch (e) {
    const { logger } = await import("@/lib/logger");
    logger.warn("HIS_API_ERROR", "병원 온보딩 시드 실패", { hospitalCafeId: opts.hospitalCafeId, error: (e as Error).message });
  }

  try {
    const { logger } = await import("@/lib/logger");
    logger.audit("HIS_CHANNEL_PROVISION", { hospitalCafeId: opts.hospitalCafeId, channelCafeId: cafe.id, slug: cafe.slug, ownerId: opts.ownerId });
  } catch {}

  return { workspace: { workspaceSlug: cafe.slug, workspaceName: cafe.name, url: `${CHANNEL_HOST}/${cafe.slug}`, plan: "clinic" }, idempotent: false };
}

/** 링크 비활성 (워크스페이스는 보존 — 파괴적 삭제 없음) */
export async function unlinkChannelWorkspace(hospitalCafeId: string): Promise<void> {
  await pool.query(`UPDATE his_channel_links SET active = false WHERE hospital_cafe_id = $1 AND active = true`, [hospitalCafeId]);
  await pool.query(`UPDATE wsign_workspace_links SET active = false WHERE source_cafe_id = $1 AND active = true`, [hospitalCafeId]).catch(() => {});
  try {
    const { logger } = await import("@/lib/logger");
    logger.audit("HIS_CHANNEL_PROVISION", { hospitalCafeId, action: "unlink" });
  } catch {}
}

// ─── 엔터프라이즈(company/organization) 일반화 경로 ───────────────────────────
// 병원 경로와 달리 his_channel_links/승인게이트/clinic 시드 없이 wsign_workspace_links 단일 트래킹.
// 병원 함수는 회귀 방지를 위해 불변 유지(E3), 엔터프라이즈는 아래 형제 함수 사용.

/** 엔터프라이즈↔채널 워크스페이스 링크 현황 (wsign_workspace_links 기반, 최신 1건) */
export async function getEnterpriseChannelLinkStatus(sourceCafeId: string): Promise<ChannelLinkStatus | null> {
  const rows = await pool.query(
    `SELECT l.id, l.channel_cafe_id, l.active, l.created_at, c.slug, c.name
     FROM wsign_workspace_links l JOIN cafes c ON c.id = l.channel_cafe_id
     WHERE l.source_cafe_id = $1 AND (c.source = 'wchannel' OR c.cafe_type = 'channel')
     ORDER BY l.created_at DESC LIMIT 1`, [sourceCafeId]).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const r = rows.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    linkId: r.id as string, active: r.active as boolean,
    workspaceSlug: r.slug as string, workspaceName: r.name as string,
    url: `${CHANNEL_HOST}/${r.slug}`, createdAt: r.created_at as Date,
  };
}

export interface EnterpriseProvisionOpts {
  sourceCafeId: string;
  sourceCafeName: string;
  sourceCode: string;
  ownerId: string;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
}

/** 엔터프라이즈 워크스페이스 생성 (기업당 1개, 멱등). 활성 링크 있으면 기존 반환. */
export async function provisionEnterpriseChannelWorkspace(opts: EnterpriseProvisionOpts): Promise<{ workspace: { workspaceSlug: string; workspaceName: string; url: string; plan: string }; idempotent: boolean }> {
  const existing = await getEnterpriseChannelLinkStatus(opts.sourceCafeId);
  if (existing?.active) {
    return { workspace: { workspaceSlug: existing.workspaceSlug, workspaceName: existing.workspaceName, url: existing.url, plan: "enterprise" }, idempotent: true };
  }
  // 해제된 링크가 있으면 재활성(W3 재연동) — 새 워크스페이스 중복 생성 방지
  if (existing) {
    await pool.query(`UPDATE wsign_workspace_links SET active = true, sync_org = true WHERE id = $1`, [existing.linkId]);
    return { workspace: { workspaceSlug: existing.workspaceSlug, workspaceName: existing.workspaceName, url: existing.url, plan: "enterprise" }, idempotent: true };
  }

  const name = opts.name?.trim() || `${opts.sourceCafeName} 채널`;
  const baseSlug = opts.slug ? (opts.slug.startsWith("wc-") ? opts.slug : `wc-${opts.slug}`) : `wc-${opts.sourceCode.toLowerCase()}`;
  const slug = await uniqueSlug(baseSlug, async (s) => !!(await prisma.cafe.findUnique({ where: { slug: s }, select: { id: true } })));

  const cafe = await prisma.cafe.create({
    data: {
      name, slug,
      description: opts.description ?? `${opts.sourceCafeName} 그룹웨어 연동 워크스페이스`,
      visibility: "PRIVATE",
      ownerId: opts.ownerId,
      boardEnabled: true,
      wsignEnabled: true,
      manageEnabled: true,
      members: { create: { userId: opts.ownerId, role: "OWNER", status: "ACTIVE" } },
    },
    select: { id: true, slug: true, name: true },
  });

  const cafeCode = await generateCafeCode();
  await pool.query(`UPDATE cafes SET cafe_code=$1, cafe_type='organization', source='wchannel' WHERE id=$2`, [cafeCode, cafe.id]);
  await pool.query(`INSERT INTO workspace_subscriptions (cafe_id, plan, status) VALUES ($1, 'enterprise', 'active') ON CONFLICT DO NOTHING`, [cafe.id]);

  const notice = await prisma.boardChannel.create({
    data: { cafeId: cafe.id, name: "공지", description: "기업 공지 · 결재 알림", isPrivate: false, createdBy: opts.ownerId, sortOrder: 0 },
    select: { id: true },
  });
  await prisma.boardChannel.create({
    data: { cafeId: cafe.id, name: "일반", description: "자유 대화", isPrivate: false, createdBy: opts.ownerId, sortOrder: 1 },
  }).catch(() => {});

  try {
    const { joinActiveMembersToPublicChannels } = await import("@/lib/his/org-sync");
    await joinActiveMembersToPublicChannels(cafe.id);
  } catch { /* non-fatal */ }

  // 결재/공지 카드 발행 링크 — 금액 마스킹 기본 true(W6)
  await pool.query(
    `INSERT INTO wsign_workspace_links (id, source_cafe_id, channel_cafe_id, default_channel_id, notify_mode, sync_org, mask_amount, created_by, active)
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'mention', true, true, $4, true)
     ON CONFLICT (source_cafe_id, channel_cafe_id) DO UPDATE SET active = true, sync_org = true, default_channel_id = EXCLUDED.default_channel_id`,
    [opts.sourceCafeId, cafe.id, notice.id, opts.ownerId]);

  try {
    const { logger } = await import("@/lib/logger");
    logger.audit("HIS_CHANNEL_PROVISION", { kind: "enterprise", sourceCafeId: opts.sourceCafeId, channelCafeId: cafe.id, slug: cafe.slug, ownerId: opts.ownerId });
  } catch {}

  return { workspace: { workspaceSlug: cafe.slug, workspaceName: cafe.name, url: `${CHANNEL_HOST}/${cafe.slug}`, plan: "enterprise" }, idempotent: false };
}

/** 이미 만들어진 채널 워크스페이스를 소스 카페에 연동 (신규 생성 대신).
 *  대상 = 채널 워크스페이스 카페(source='wchannel' 또는 구형 cafe_type='channel'). 멱등(재연동=재활성). */
export async function linkExistingChannelWorkspace(opts: {
  sourceCafeId: string;
  workspaceSlug: string;
  actorId: string;
}): Promise<{ workspaceSlug: string; workspaceName: string; url: string }> {
  const ws = await pool.query(
    `SELECT id, slug, name FROM cafes
     WHERE slug = $1 AND (source = 'wchannel' OR cafe_type = 'channel')`, [opts.workspaceSlug]);
  if (!ws.rows[0]) {
    const { NotFoundError } = await import("@/lib/errors");
    throw new NotFoundError("채널 워크스페이스를 찾을 수 없습니다");
  }
  const wsCafe = ws.rows[0] as { id: string; slug: string; name: string };
  if (wsCafe.id === opts.sourceCafeId) {
    const { BadRequestError } = await import("@/lib/errors");
    throw new BadRequestError("자기 자신은 연동할 수 없습니다");
  }

  // 대상 워크스페이스 운영 권한 (타인 워크스페이스 무단 연동 방지)
  const member = await pool.query(
    `SELECT role FROM cafe_members WHERE cafe_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [wsCafe.id, opts.actorId]);
  if (!member.rows[0] || !["OWNER", "MANAGER"].includes(member.rows[0].role)) {
    const { ForbiddenError } = await import("@/lib/errors");
    throw new ForbiddenError("해당 워크스페이스의 운영진만 연동할 수 있습니다");
  }

  // 기본 발행 채널: 공지 우선, 없으면 첫 공개 채널
  const ch = await pool.query(
    `SELECT id FROM board_channels WHERE cafe_id = $1 AND is_active = true AND is_private = false
     ORDER BY (name = '공지') DESC, sort_order ASC LIMIT 1`, [wsCafe.id]);
  const defaultChannelId = ch.rows[0]?.id ?? null;

  await pool.query(
    `INSERT INTO wsign_workspace_links (id, source_cafe_id, channel_cafe_id, default_channel_id, notify_mode, sync_org, mask_amount, created_by, active)
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'mention', true, true, $4, true)
     ON CONFLICT (source_cafe_id, channel_cafe_id) DO UPDATE SET active = true, sync_org = true, default_channel_id = EXCLUDED.default_channel_id`,
    [opts.sourceCafeId, wsCafe.id, defaultChannelId, opts.actorId]);

  try {
    const { logger } = await import("@/lib/logger");
    logger.audit("HIS_CHANNEL_PROVISION", { kind: "enterprise", action: "link-existing", sourceCafeId: opts.sourceCafeId, channelCafeId: wsCafe.id, actorId: opts.actorId });
  } catch {}

  return { workspaceSlug: wsCafe.slug, workspaceName: wsCafe.name, url: `${CHANNEL_HOST}/${wsCafe.slug}` };
}

/** 활성 연동 워크스페이스 전체 목록 (복수 연동 지원 — 카드 브리지는 전 링크 팬아웃) */
/** 연동 링크 목록.
 *  기본은 **활성 링크만** — 조직 싱크·카드 발행 대상은 활성이어야 한다.
 *  `includeInactive`는 관리 화면 전용이다: 해제된 링크가 목록에서 사라지면 **재연동할 방법이 없다**(W3). */
export async function listEnterpriseChannelLinks(
  sourceCafeId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Array<{ linkId: string; channelCafeId: string; slug: string; name: string; url: string; notifyMode: string; maskAmount: boolean; active: boolean }>> {
  const rows = await pool.query(
    `SELECT l.id, l.channel_cafe_id, l.notify_mode, l.mask_amount, l.active, c.slug, c.name
     FROM wsign_workspace_links l JOIN cafes c ON c.id = l.channel_cafe_id
     WHERE l.source_cafe_id = $1 AND (c.source = 'wchannel' OR c.cafe_type = 'channel')
       ${opts.includeInactive ? "" : "AND l.active = true"}
     ORDER BY l.active DESC, l.created_at ASC`, [sourceCafeId]).catch(() => ({ rows: [] }));
  return (rows.rows as Array<{ id: string; channel_cafe_id: string; slug: string; name: string; notify_mode: string; mask_amount: boolean; active: boolean }>).map(r => ({
    linkId: r.id, channelCafeId: r.channel_cafe_id, slug: r.slug, name: r.name, url: `${CHANNEL_HOST}/${r.slug}`,
    notifyMode: r.notify_mode, maskAmount: r.mask_amount, active: r.active,
  }));
}

/** 연동 해제/재연동 (W3) — `active` 토글.
 *
 * 해제해도 **워크스페이스·조직·결재 데이터는 그대로 둔다.** 끊기는 것은 카드 발행·조직 싱크 대상뿐이다
 * (`getLinksForSource`가 active=true만 반환). 재연동하면 그대로 되살아난다.
 * 워크스페이스 폐쇄는 이 함수의 일이 아니다(별도 경로).
 * @returns 바뀐 행이 있으면 true (이미 같은 상태면 false)
 */
export async function setEnterpriseChannelLinkActive(
  sourceCafeId: string, workspaceSlug: string, active: boolean,
): Promise<boolean> {
  const r = await pool.query(
    `UPDATE wsign_workspace_links SET active = $3
      WHERE source_cafe_id = $1 AND active <> $3
        AND channel_cafe_id = (SELECT id FROM cafes WHERE slug = $2)`,
    [sourceCafeId, workspaceSlug, active]);
  const changed = (r.rowCount ?? 0) > 0;
  if (changed) {
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_CHANNEL_PROVISION", {
        kind: "enterprise", sourceCafeId, workspaceSlug,
        action: active ? "relink" : "unlink",
      });
    } catch { /* 감사 로그 실패는 비치명 */ }
  }
  return changed;
}

/** 링크별 알림/마스킹 설정 (W4) — notify_mode: mention(카드+멘션)/card(카드만)/off(전송 안 함) */
export async function updateEnterpriseChannelLinkSettings(opts: {
  sourceCafeId: string; workspaceSlug: string; notifyMode?: string; maskAmount?: boolean;
}): Promise<boolean> {
  const r = await pool.query(
    `UPDATE wsign_workspace_links SET
       notify_mode = COALESCE($3, notify_mode),
       mask_amount = COALESCE($4, mask_amount)
     WHERE source_cafe_id = $1 AND active = true
       AND channel_cafe_id = (SELECT id FROM cafes WHERE slug = $2)`,
    [opts.sourceCafeId, opts.workspaceSlug, opts.notifyMode ?? null, opts.maskAmount ?? null]);
  return (r.rowCount ?? 0) > 0;
}

/** 사용자가 운영(OWNER/MANAGER)하는 연동 가능 채널 워크스페이스 목록 (연동 선택 UI용) */
export async function listLinkableWorkspaces(userId: string): Promise<Array<{ slug: string; name: string }>> {
  const rows = await pool.query(
    `SELECT c.slug, c.name FROM cafe_members cm
     JOIN cafes c ON c.id = cm.cafe_id
     WHERE cm.user_id = $1 AND cm.status = 'ACTIVE' AND cm.role IN ('OWNER','MANAGER')
       AND (c.source = 'wchannel' OR c.cafe_type = 'channel')
     ORDER BY c.name LIMIT 20`, [userId]).catch(() => ({ rows: [] }));
  return rows.rows as Array<{ slug: string; name: string }>;
}

/** 엔터프라이즈 링크 비활성 (워크스페이스 보존). workspaceSlug 지정 시 해당 링크만, 없으면 전체. */
export async function unlinkEnterpriseChannelWorkspace(sourceCafeId: string, workspaceSlug?: string): Promise<void> {
  if (workspaceSlug) {
    await pool.query(
      `UPDATE wsign_workspace_links SET active = false
       WHERE source_cafe_id = $1 AND active = true
         AND channel_cafe_id = (SELECT id FROM cafes WHERE slug = $2)`, [sourceCafeId, workspaceSlug]);
  } else {
    await pool.query(`UPDATE wsign_workspace_links SET active = false WHERE source_cafe_id = $1 AND active = true`, [sourceCafeId]);
  }
  try {
    const { logger } = await import("@/lib/logger");
    logger.audit("HIS_CHANNEL_PROVISION", { kind: "enterprise", sourceCafeId, action: "unlink", workspaceSlug: workspaceSlug ?? "all" });
  } catch {}
}
