// Created: 2026-05-08
// POST /api/clinic/his/staff/sync — HIS 직원 일괄 등록/동기화
// DELETE /api/clinic/his/staff/sync — HIS 직원 비활성화
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth } from "@/lib/his/auth";
import { handleError, BadRequestError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import crypto from "crypto";

// 2026-07-17 — HIS 피드백 반영: 널/미지원 값 관대화 (null 필드 수용, 알 수 없는 hisRole은 Staff 폴백 — 500/거부 방지)
const KNOWN_HIS_ROLES = new Set(["Admin", "Doctor", "Nurse", "Pharmacist", "LabTech", "Support", "Staff"]);
const staffItemSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(50),
  password: z.string().min(8).max(100),
  department: z.string().max(50).nullish(),
  position: z.string().max(50).nullish(),
  hisRole: z.string().max(30).nullish().transform((v) => (v && KNOWN_HIS_ROLES.has(v) ? v : "Staff")),
  license: z.string().max(50).nullish(),
  specialty: z.string().max(100).nullish(),
});

const syncSchema = z.object({
  hospitalCode: z.string().optional(),
  staff: z.array(staffItemSchema).min(1).max(500),
});

// POST — HIS 직원 일괄 등록
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    await rateLimit(request, "write");
    const body = await request.json();
    const data = syncSchema.parse(body);

    const details: Array<{ email: string; status: string; clinicUserId?: string; reason?: string }> = [];
    let registered = 0;
    let skipped = 0;

    for (const s of data.staff) {
      // 1. 이메일로 기존 사용자 확인
      const _email = s.email.toLowerCase();
      const existingUsers = await prisma.$queryRaw<{ id: string; username: string }[]>`SELECT id, username FROM users WHERE email = ${_email} LIMIT 1`;

      let userId: string;

      if (existingUsers.length > 0) {
        userId = existingUsers[0].id;

        // 이미 카페 멤버인지 확인
        const existingMember = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM cafe_members WHERE cafe_id = ${ctx.cafeId} AND user_id = ${userId}`;

        if (existingMember.length > 0) {
          // 역할 매핑만 업데이트
          const _dept = s.department ?? null;
          const _license = s.license ?? null;
          const _meta = JSON.stringify({ position: s.position, specialty: s.specialty, source: "his_sync" });
          await prisma.$executeRaw`INSERT INTO his_role_mappings (id, cafe_id, user_id, his_role, department, license_number, metadata, updated_at)
             VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${userId}, ${s.hisRole}, ${_dept}, ${_license}, ${_meta}, now())
             ON CONFLICT (cafe_id, user_id) DO UPDATE SET
               his_role=${s.hisRole}, department=${_dept}, license_number=${_license}, metadata=his_role_mappings.metadata || ${_meta}, updated_at=now()`;
          details.push({ email: s.email, status: "skipped", clinicUserId: userId, reason: "already_exists" });
          skipped++;
          continue;
        }
      } else {
        // 2. 신규 사용자 생성 (임시 비밀번호, 이메일 미인증 상태)
        userId = crypto.randomUUID();
        const username = s.name.replace(/\s+/g, "").slice(0, 20) || s.email.split("@")[0];
        // 중복 username 처리
        const usernameCheck = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE username = ${username}`;
        const finalUsername = usernameCheck.length > 0 ? `${username}_${Date.now().toString(36).slice(-4)}` : username;

        // HIS에서 전달받은 비밀번호로 해시 생성 — async(이벤트 루프 블로킹 방지, H4)
        const bcrypt = await import("bcrypt");
        const hashedPassword = await bcrypt.default.hash(s.password, 12);

        await prisma.$executeRaw`INSERT INTO users (id, email, username, password_hash, role, email_verified, created_at, updated_at)
           VALUES (${userId}, ${s.email.toLowerCase()}, ${finalUsername}, ${hashedPassword}, 'MEMBER', true, now(), now())`;
      }

      // 3. 카페 멤버 추가
      const clinicRole = s.hisRole === "Admin" ? "MANAGER" : "REGULAR";
      await prisma.$executeRaw`INSERT INTO cafe_members (id, cafe_id, user_id, role, joined_at)
         VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${userId}, ${clinicRole}, now())
         ON CONFLICT DO NOTHING`;

      // 4. HIS 역할 매핑
      const _dept2 = s.department ?? null;
      const _license2 = s.license ?? null;
      const _meta2 = JSON.stringify({ position: s.position, specialty: s.specialty, source: "his_sync" });
      await prisma.$executeRaw`INSERT INTO his_role_mappings (id, cafe_id, user_id, his_role, department, license_number, metadata, updated_at)
         VALUES (gen_random_uuid()::text, ${ctx.cafeId}, ${userId}, ${s.hisRole}, ${_dept2}, ${_license2}, ${_meta2}, now())
         ON CONFLICT (cafe_id, user_id) DO UPDATE SET
           his_role=${s.hisRole}, department=${_dept2}, license_number=${_license2}, metadata=his_role_mappings.metadata || ${_meta2}, updated_at=now()`;

      details.push({ email: s.email, status: "registered", clinicUserId: userId });
      registered++;
    }

    // 감사 로그
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_STAFF_SYNC", { cafeId: ctx.cafeId, total: data.staff.length, registered, skipped });
    } catch {}

    return NextResponse.json({ registered, skipped, errors: [], details });
  } catch (err) { return handleError(err); }
}

// DELETE — HIS 직원 비활성화
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    const body = await request.json();
    const { emails } = body;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      throw new BadRequestError("emails 배열이 필요합니다");
    }

    let deactivated = 0;
    for (const email of emails) {
      const users = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
      if (users.length === 0) continue;

      // 카페 멤버에서 제거 (soft: role을 BANNED로 변경)
      await prisma.$executeRaw`UPDATE cafe_members SET status = 'BANNED' WHERE cafe_id = ${ctx.cafeId} AND user_id = ${users[0].id}`;
      deactivated++;
    }

    return NextResponse.json({ ok: true, deactivated });
  } catch (err) { return handleError(err); }
}
