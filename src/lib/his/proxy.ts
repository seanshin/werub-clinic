// Created: 2026-05-20
// HIS API 프록시 헬퍼 — 서버사이드 인증 + 병원 코드 자동 해석

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, type JwtPayload } from "@/lib/middleware/auth";
import { handleError, ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

interface HisProxyContext {
  user: JwtPayload;
  hospitalCode: string;
  cafeId: string;
}

const hospitalCache = new Map<string, { code: string; cafeId: string; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5분

/**
 * 유저의 병원 cafe 소속 → enterprise_code 조회 (5분 캐시)
 */
async function resolveHospitalContext(user: JwtPayload): Promise<HisProxyContext> {
  const cached = hospitalCache.get(user.userId);
  if (cached && cached.expiry > Date.now()) {
    return { user, hospitalCode: cached.code, cafeId: cached.cafeId };
  }

  const rows = await prisma.$queryRaw<Array<{ id: string; enterprise_code: string }>>`
    SELECT c.id, c.enterprise_code
    FROM cafe_members cm
    JOIN cafes c ON c.id = cm.cafe_id
    WHERE cm.user_id = ${user.userId}
      AND c.cafe_type IN ('hospital', 'clinic')
      AND c.enterprise_code IS NOT NULL
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new ForbiddenError("병원 소속이 아닙니다");
  }

  hospitalCache.set(user.userId, {
    code: rows[0].enterprise_code,
    cafeId: rows[0].id,
    expiry: Date.now() + CACHE_TTL,
  });

  return { user, hospitalCode: rows[0].enterprise_code, cafeId: rows[0].id };
}

/**
 * 캐시 무효화 (병원 소속 변경 시)
 */
export function invalidateHospitalCache(userId: string) {
  hospitalCache.delete(userId);
}

/**
 * HIS API 프록시 공통 핸들러
 * - requireAuth → 유저 병원 조회 → HIS_API_KEY + hospitalCode 세팅 → HIS 호출
 */
export async function hisProxy(
  request: NextRequest,
  opts: { pathPrefix: string; hisPrefix: string },
): Promise<NextResponse> {
  try {
    const user = await requireAuth(request, { skipCsrf: true });
    const ctx = await resolveHospitalContext(user);

    const hisApiKey = process.env.HIS_API_KEY;
    if (!hisApiKey) {
      logger.warn("HIS_API_ERROR", "HIS_API_KEY 환경변수 미설정 — mock 폴백 예상");
      return NextResponse.json({ ok: false, error: "HIS_API_KEY not configured" }, { status: 503 });
    }

    const url = new URL(request.url);
    const hisPath = url.pathname.replace(opts.pathPrefix, opts.hisPrefix);
    const hisUrl = process.env.HIS_URL ?? "https://his.example.org";
    const target = `${hisUrl}${hisPath}${url.search}`;

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${hisApiKey}`,
      "X-Hospital-Code": ctx.hospitalCode,
      "X-User-Id": user.userId,
    };
    if (request.headers.get("content-type")) {
      headers["Content-Type"] = request.headers.get("content-type")!;
    }

    const init: RequestInit = { method: request.method, headers };
    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = await request.text();
    }

    // SSE 요청(실시간 동선 이벤트 등): 타임아웃 없이 스트림 패스스루
    const wantsSse = (request.headers.get("accept") || "").includes("text/event-stream");

    const hisRes = await fetch(target, {
      ...init,
      // SSE는 장수명 연결 — AbortSignal.timeout 적용 시 끊김
      ...(wantsSse ? {} : { signal: AbortSignal.timeout(10_000) }),
    });

    if (wantsSse || (hisRes.headers.get("content-type") || "").includes("text/event-stream")) {
      return new NextResponse(hisRes.body, {
        status: hisRes.status,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no", // Nginx 버퍼링 비활성 (즉시 전달)
        },
      });
    }

    const data = await hisRes.json();
    return NextResponse.json(data, { status: hisRes.status });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      logger.warn("HIS_API_TIMEOUT", "HIS API 타임아웃", { url: request.url });
      return NextResponse.json({ ok: false, error: "HIS API timeout" }, { status: 504 });
    }
    return handleError(err);
  }
}
