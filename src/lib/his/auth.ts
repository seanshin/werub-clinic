// Created: 2026-05-06
// HIS API 인증 미들웨어 — API 키 + 병원 코드 검증
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import crypto from "crypto";

export interface HisAuthContext {
  apiKeyId: string;
  cafeId: string;
  cafeName: string;
  cafeType: string;
  hospitalCode: string;
  permissions: string[];
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * HIS API 인증 미들웨어
 * Header: Authorization: Bearer his_xxx...
 * Header: X-Hospital-Code: WRB-XXXX-XXXX
 */
export async function requireHisAuth(request: NextRequest, requiredPermission?: string): Promise<HisAuthContext> {
  const authHeader = request.headers.get("authorization");
  const hospitalCode = request.headers.get("x-hospital-code");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("API 키가 필요합니다 (Authorization: Bearer ...)");
  }
  if (!hospitalCode) {
    throw new UnauthorizedError("병원 코드가 필요합니다 (X-Hospital-Code)");
  }

  const apiKey = authHeader.slice(7);
  const keyHash = hashKey(apiKey);

  // API 키 조회
  const keys = await prisma.$queryRaw<Array<{
    id: string; cafe_id: string; permissions: string[]; ip_whitelist: string[];
    is_active: boolean; expires_at: Date | null;
  }>>`
    SELECT id, cafe_id, permissions, ip_whitelist, is_active, expires_at
    FROM his_api_keys WHERE key_hash = ${keyHash}
  `;

  const key = keys[0];
  if (!key) throw new UnauthorizedError("유효하지 않은 API 키입니다");
  if (!key.is_active) throw new ForbiddenError("비활성화된 API 키입니다");
  if (key.expires_at && new Date(key.expires_at) < new Date()) throw new ForbiddenError("만료된 API 키입니다");

  // [M-6] IP 화이트리스트 검증 — IP 헤더 없으면 거부 (우회 방지)
  if (key.ip_whitelist.length > 0) {
    const clientIp = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (!clientIp || !key.ip_whitelist.includes(clientIp)) {
      throw new ForbiddenError("허용되지 않은 IP입니다");
    }
  }

  // 병원 코드 ↔ API 키 카페 일치 확인
  const upperCode = hospitalCode.toUpperCase();
  const cafes = await prisma.$queryRaw<Array<{
    id: string; name: string; cafe_type: string; enterprise_code: string;
  }>>`
    SELECT id, name, cafe_type, enterprise_code FROM cafes
    WHERE id = ${key.cafe_id} AND enterprise_code = ${upperCode} AND cafe_type IN ('hospital', 'clinic')
  `;

  if (cafes.length === 0) throw new ForbiddenError("병원 코드와 API 키가 일치하지 않습니다");
  const cafe = cafes[0];

  // 권한 확인 — 빈 permissions = 권한 없음(거부, fail-closed). '*' = 전권. (C2)
  if (requiredPermission && !key.permissions.includes("*") && !key.permissions.includes(requiredPermission)) {
    throw new ForbiddenError(`이 API 키에는 '${requiredPermission}' 권한이 없습니다`);
  }

  // 중앙 레이트리밋 — 전 HIS 라우트를 API키 기준으로 스로틀(남용/폭주 방지). 티어 webhook(300/분, 외부 시스템용). (보안 후속 #2)
  try {
    const { rateLimit } = await import("@/lib/rate-limit");
    await rateLimit(request, "webhook", `his:${key.id}`);
  } catch (e) {
    if (e instanceof Error && e.name === "TooManyRequestsError") throw e;
    // rate-limit 인프라 오류는 인증을 막지 않음
  }

  // last_used_at 갱신 (fire-and-forget)
  prisma.$executeRaw`
    UPDATE his_api_keys SET last_used_at = now() WHERE id = ${key.id}
  `.catch(() => {});

  return {
    apiKeyId: key.id,
    cafeId: cafe.id,
    cafeName: cafe.name,
    cafeType: cafe.cafe_type,
    hospitalCode: cafe.enterprise_code,
    permissions: key.permissions,
  };
}

/**
 * API 키 생성 유틸
 * @returns { key: 원본 키 (1회만 표시), keyHash, keyPrefix }
 */
export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  // 접두어 clinic_ — WeRU.B Clinic 발급 키임을 명시(2026-06-08, 기존 his_ 키는 해시 검증이라 그대로 동작).
  const key = `clinic_${raw}`;
  return {
    key,
    keyHash: hashKey(key),
    keyPrefix: key.slice(0, 15), // clinic_ + 8 hex
  };
}

/**
 * SSO 토큰 생성
 */
export function generateSsoToken(): { token: string; tokenHash: string } {
  const token = `sso_${crypto.randomBytes(32).toString("hex")}`;
  return {
    token,
    tokenHash: hashKey(token),
  };
}

export function hashSsoToken(token: string): string {
  return hashKey(token);
}
