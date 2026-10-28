// Created: 2026-05-06
// Updated: 2026-05-07 — [C-2] requireHisAuth + rateLimit 추가, [M-1] 감사 로그
// POST /api/clinic/sso/verify — SSO 토큰 검증 (HIS → Clinic)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, BadRequestError, UnauthorizedError } from "@/lib/errors";
import { hashSsoToken, requireHisAuth } from "@/lib/his/auth";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    // [C-2] HIS API 키 인증 + Rate Limit
    await requireHisAuth(request, "staff");
    await rateLimit(request, "write");

    const body = await request.json();
    const token = body.token as string;
    if (!token || typeof token !== "string") throw new BadRequestError("token이 필요합니다");

    const tokenHash = hashSsoToken(token);

    // 토큰 조회 + 사용 여부 + 만료 확인
    const tokens = await prisma.$queryRaw<Array<{
      id: string; user_id: string; cafe_id: string; used: boolean; expires_at: Date;
    }>>`SELECT id, user_id, cafe_id, used, expires_at
       FROM his_sso_tokens WHERE token_hash = ${tokenHash}`;

    const ssoToken = tokens[0];
    if (!ssoToken) throw new UnauthorizedError("유효하지 않은 SSO 토큰입니다");
    if (ssoToken.used) throw new UnauthorizedError("이미 사용된 SSO 토큰입니다");
    if (new Date(ssoToken.expires_at) < new Date()) throw new UnauthorizedError("만료된 SSO 토큰입니다");

    // 토큰 사용 처리
    await prisma.$executeRaw`UPDATE his_sso_tokens SET used = true, used_at = now() WHERE id = ${ssoToken.id}`;

    // 사용자 + 병원 정보 + 역할 매핑 조회
    const users = await prisma.$queryRaw<Array<{
      username: string; email: string; profile_image: string | null;
    }>>`SELECT username, email, profile_image FROM users WHERE id = ${ssoToken.user_id}`;

    const cafes = await prisma.$queryRaw<Array<{
      name: string; cafe_type: string; enterprise_code: string;
    }>>`SELECT name, cafe_type, enterprise_code FROM cafes WHERE id = ${ssoToken.cafe_id}`;

    const members = await prisma.$queryRaw<Array<{ role: string }>>`SELECT role FROM cafe_members WHERE cafe_id = ${ssoToken.cafe_id} AND user_id = ${ssoToken.user_id}`;

    const roleMappings = await prisma.$queryRaw<Array<{
      his_role: string; department: string | null; license_number: string | null; specialties: string[];
    }>>`SELECT his_role, department, license_number, specialties
       FROM his_role_mappings WHERE cafe_id = ${ssoToken.cafe_id} AND user_id = ${ssoToken.user_id}`;

    const user = users[0];
    const cafe = cafes[0];
    const member = members[0];
    const mapping = roleMappings[0];

    // [M-1] 감사 로그
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_SSO_VERIFY", { userId: ssoToken.user_id, cafeId: ssoToken.cafe_id, tokenId: ssoToken.id });
    } catch {}

    // 역할명 HIS 형식(대문자) 매핑
    const hisRoleRaw = mapping?.his_role ?? "Staff";
    const HIS_ROLE_MAP: Record<string, string> = { Admin: "ADMIN", Doctor: "DOCTOR", Nurse: "NURSE", Pharmacist: "PHARMACIST", LabTech: "LAB_TECH", Staff: "STAFF" };

    return NextResponse.json({
      valid: true,
      user: {
        id: ssoToken.user_id,
        email: user?.email,
        username: user?.username,
        profileImage: user?.profile_image,
        role: member?.role ?? "REGULAR",
        hisRole: hisRoleRaw,
        hisUserRole: HIS_ROLE_MAP[hisRoleRaw] ?? hisRoleRaw.toUpperCase(),
        department: mapping?.department ?? null,
        licenseNumber: mapping?.license_number ?? null,
        specialties: mapping?.specialties ?? [],
        hospitalId: ssoToken.cafe_id,
        hospitalName: cafe?.name,
        hospitalCode: cafe?.enterprise_code,
        hospitalType: cafe?.cafe_type,
      },
    });
  } catch (err) { return handleError(err); }
}
