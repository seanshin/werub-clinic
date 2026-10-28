// Created: 2026-05-06
// Updated: 2026-05-06 — 비로그인 병원 등록 (계정 없이 신청, 관리자 승인 후 코드 발급)
// POST /api/clinic/register — 병원 등록 신청 (인증 불필요)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleError, BadRequestError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import crypto from "crypto";
import { logger } from "@/lib/logger";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  businessNumber: z.string().optional().default(""),
  representativeName: z.string().optional().default(""),
  industry: z.string().optional().default(""), // 진료과
  employeeCount: z.string().optional().default(""),
  cafeType: z.enum(["hospital", "clinic"]).default("clinic"),
  features: z.record(z.string(), z.boolean()).optional(),
  // 담당자 정보 (비로그인이므로 별도 수집)
  contactName: z.string().min(1, "담당자 이름을 입력하세요").max(50),
  contactEmail: z.string().email("올바른 이메일을 입력하세요"),
  contactPhone: z.string().optional().default(""),
  hisEnabled: z.boolean().optional().default(false),
});

function generateHospitalCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
  return `WRB-${part()}-${part()}`;
}

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[()（）\[\]{}]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 15);
  const ts = Date.now().toString(36).slice(-6);
  return base ? `${base}-${ts}` : `clinic-${ts}`;
}

export async function POST(request: NextRequest) {
  try {
    await rateLimit(request, "write");
    const body = await request.json();
    const data = registerSchema.parse(body);

    // 사업자등록번호 중복 체크
    if (data.businessNumber) {
      const byBizNum = await prisma.$queryRaw<{
        id: string; name: string;
      }[]>`SELECT id, name FROM cafes
         WHERE settings->>'businessNumber' = ${data.businessNumber}
           AND cafe_type IN ('hospital', 'clinic')
         LIMIT 1`;
      if (byBizNum.length > 0) {
        return NextResponse.json({
          ok: true, already: true,
          cafe: { name: byBizNum[0].name },
          message: `이미 등록된 사업자번호입니다: ${byBizNum[0].name}`,
        });
      }
    }

    // 같은 담당자 이메일로 이미 신청된 병원 체크
    const existingByEmail = await prisma.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM cafes
       WHERE settings->>'contactEmail' = ${data.contactEmail}
         AND cafe_type IN ('hospital', 'clinic')
       LIMIT 1`;
    if (existingByEmail.length > 0) {
      return NextResponse.json({
        ok: true, already: true,
        cafe: { name: existingByEmail[0].name },
        message: `이 이메일로 이미 등록된 병원이 있습니다: ${existingByEmail[0].name}`,
      });
    }

    // 슬러그 생성
    let slug = generateSlug(data.name);
    const slugExists = await prisma.cafe.findUnique({ where: { slug }, select: { id: true } });
    if (slugExists) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    // 병원 코드 생성 (승인 전까지 비활성)
    let code = "";
    for (let i = 0; i < 10; i++) {
      code = generateHospitalCode();
      const dup = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM cafes WHERE enterprise_code = ${code}`;
      if (dup.length === 0) break;
    }

    const settings = JSON.stringify({
      groupwareFeatures: data.features ?? {},
      businessNumber: data.businessNumber,
      representativeName: data.representativeName,
      specialty: data.industry,
      employeeCount: data.employeeCount,
      serviceType: "hospital",
      // 담당자 정보 (비로그인 등록이므로 settings에 저장)
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      hisEnabled: data.hisEnabled,
    });

    // owner_id NOT NULL 제약 → 시스템 관리자(ADMIN) 계정을 임시 owner로 지정
    // 승인 후 담당자가 가입하면 owner 이전 가능
    const adminRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') ORDER BY created_at ASC LIMIT 1`;
    const ownerId = adminRows[0]?.id;
    if (!ownerId) {
      return NextResponse.json({ error: "시스템 관리자 계정이 없습니다. 관리자에게 문의하세요." }, { status: 500 });
    }

    // 병원 등록: pending_approval, enterprise_code_active=false
    const description = `${data.name} 병원 플랫폼`;
    const bizNum = data.businessNumber || null;
    const rep = data.representativeName || null;
    const cafeRows = await prisma.$queryRaw<[{ id: string }]>`INSERT INTO cafes (id, name, slug, description, cafe_type, visibility, settings,
        cafe_status, enterprise_code, enterprise_code_active, owner_id,
        business_number, representative, company_name,
        wsign_enabled, board_enabled, calendar_enabled, sharespace_enabled, manage_enabled,
        created_at, updated_at)
       VALUES (gen_random_uuid()::text, ${data.name}, ${slug}, ${description}, ${data.cafeType}, 'PRIVATE', ${settings}::jsonb,
        'pending_approval', ${code}, false, ${ownerId},
        ${bizNum}, ${rep}, ${data.name},
        true, true, true, true, true,
        now(), now())
       RETURNING id`;
    const cafeId = cafeRows[0].id;

    // 시스템 관리자를 OWNER 멤버로 추가
    await prisma.$executeRaw`INSERT INTO cafe_members (id, cafe_id, user_id, role, joined_at)
       VALUES (gen_random_uuid()::text, ${cafeId}, ${ownerId}, 'OWNER', now())
       ON CONFLICT DO NOTHING`;

    // 담당자에게 접수 확인 이메일
    try {
      const { sendEmail } = await import("@/lib/email");
      await sendEmail({
        to: data.contactEmail,
        subject: `[WeRU.B Clinic] ${data.name} 병원 등록 접수 완료`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
            <h2 style="color:#059669">병원 등록이 접수되었습니다</h2>
            <p><strong>${data.contactName}</strong>님, 안녕하세요.</p>
            <p><strong>${data.name}</strong>의 등록 신청이 접수되었습니다.</p>
            <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:12px;padding:16px;margin:20px 0">
              <p style="margin:0;font-size:14px;font-weight:bold;color:#92400E">⏳ 관리자 검토 중</p>
              <p style="margin:8px 0 0;font-size:13px;color:#78350F">
                보통 1영업일 이내 승인 여부를 이 이메일로 안내드립니다.<br/>
                승인 시 병원 코드와 함께 사용 안내가 발송됩니다.
              </p>
            </div>
            <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
            <p style="color:#aaa;font-size:11px">WeRU.B Clinic — clinic.example.org</p>
          </div>
        `,
      });
    } catch (emailErr) {
      logger.error("clinic/register 접수 이메일 발송 실패", emailErr);
    }

    return NextResponse.json({
      ok: true,
      status: "pending_approval",
      cafe: { id: cafeId, slug, name: data.name },
      message: "병원 등록이 접수되었습니다. 시스템 관리자 승인 후 이용 가능합니다.",
    });
  } catch (err) {
    logger.error("clinic/register", err);
    return handleError(err);
  }
}
