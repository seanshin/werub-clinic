// Created: 2026-05-06
// HIS API 키 관리 — 발급/목록/폐기
// 병원 OWNER/MANAGER만 접근 가능
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { handleError, BadRequestError, ForbiddenError } from "@/lib/errors";
import { generateApiKey } from "@/lib/his/auth";
import { hasMinRole } from "@/lib/permissions";

async function getHospitalCafe(userId: string) {
  const rows = await prisma.$queryRaw<Array<{
    cafe_id: string; slug: string; name: string; role: string;
  }>>`SELECT cm.cafe_id, c.slug, c.name, cm.role
     FROM cafe_members cm JOIN cafes c ON c.id = cm.cafe_id
     WHERE cm.user_id = ${userId} AND cm.status = 'ACTIVE' AND c.cafe_type IN ('hospital', 'clinic')
     ORDER BY cm.joined_at ASC LIMIT 1`;
  if (rows.length === 0) throw new ForbiddenError("병원 소속이 아닙니다");
  if (!hasMinRole(rows[0].role, "MANAGER")) throw new ForbiddenError("관리자 권한이 필요합니다");
  return rows[0];
}

// GET — API 키 목록
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const cafe = await getHospitalCafe(user.userId);

    const keys = await prisma.$queryRaw<Array<{
      id: string; key_prefix: string; name: string; permissions: string[];
      ip_whitelist: string[]; is_active: boolean; last_used_at: Date | null;
      expires_at: Date | null; created_at: Date;
    }>>`SELECT id, key_prefix, name, permissions, ip_whitelist, is_active, last_used_at, expires_at, created_at
       FROM his_api_keys WHERE cafe_id = ${cafe.cafe_id} ORDER BY created_at DESC`;

    return NextResponse.json({
      keys: keys.map(k => ({
        id: k.id,
        prefix: k.key_prefix,
        name: k.name,
        permissions: k.permissions,
        ipWhitelist: k.ip_whitelist,
        active: k.is_active,
        lastUsedAt: k.last_used_at,
        expiresAt: k.expires_at,
        createdAt: k.created_at,
      })),
    });
  } catch (err) { return handleError(err); }
}

// POST — API 키 발급
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const cafe = await getHospitalCafe(user.userId);
    const body = await request.json();
    const name = (body.name as string)?.trim() || "default";
    const permissions = (body.permissions as string[]) || [];
    const ipWhitelist = (body.ipWhitelist as string[]) || [];

    // C2: 스코프 명시 강제 — 빈 permissions는 이제 '권한 없음'이라 발급 무의미. '*'=전권 또는 유효 스코프 목록 필수.
    const VALID_SCOPES = ["*", "wsign", "staff", "notify", "channel", "calendar", "checklist", "wiki", "leave"];
    if (permissions.length === 0) {
      throw new BadRequestError("발급할 권한(permissions)을 1개 이상 지정하세요. 전권은 ['*'].");
    }
    const invalid = permissions.filter((s) => !VALID_SCOPES.includes(s));
    if (invalid.length > 0) {
      throw new BadRequestError(`유효하지 않은 권한: ${invalid.join(", ")}. 허용: ${VALID_SCOPES.join(", ")}`);
    }

    // 최대 5개 키 제한
    const countRows = await prisma.$queryRaw<[{ cnt: bigint }]>`SELECT COUNT(*) as cnt FROM his_api_keys WHERE cafe_id = ${cafe.cafe_id} AND is_active = true`;
    if (Number(countRows[0].cnt) >= 5) throw new BadRequestError("활성 API 키는 최대 5개까지 발급 가능합니다");

    const { key, keyHash, keyPrefix } = generateApiKey();

    await prisma.$executeRaw`INSERT INTO his_api_keys (id, cafe_id, key_hash, key_prefix, name, permissions, ip_whitelist, created_by)
       VALUES (gen_random_uuid()::text, ${cafe.cafe_id}, ${keyHash}, ${keyPrefix}, ${name}, ${permissions}, ${ipWhitelist}, ${user.userId})`;

    // [M-1] 감사 로그
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_API_KEY_CREATE", { cafeId: cafe.cafe_id, keyPrefix, name, createdBy: user.userId });
    } catch {}

    return NextResponse.json({
      ok: true,
      key,  // 원본 키 — 이 응답에서만 표시, 이후 조회 불가
      prefix: keyPrefix,
      name,
      message: "API 키가 발급되었습니다. 이 키는 다시 조회할 수 없으므로 안전한 곳에 저장하세요.",
    });
  } catch (err) { return handleError(err); }
}

// DELETE — API 키 폐기
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const cafe = await getHospitalCafe(user.userId);
    const { keyId } = await request.json();
    if (!keyId) throw new BadRequestError("keyId가 필요합니다");

    const result = await prisma.$executeRaw`UPDATE his_api_keys SET is_active = false, updated_at = now()
       WHERE id = ${keyId} AND cafe_id = ${cafe.cafe_id}`;

    return NextResponse.json({ ok: true, message: "API 키가 비활성화되었습니다" });
  } catch (err) { return handleError(err); }
}
