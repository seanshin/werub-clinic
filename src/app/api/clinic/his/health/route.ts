// Created: 2026-05-20
// GET /api/clinic/his/health — HIS 시스템 연결 상태 확인
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, { skipCsrf: true });

    const hisUrl = process.env.HIS_URL ?? "https://his.example.org";
    const hisApiKey = process.env.HIS_API_KEY;

    if (!hisApiKey) {
      return NextResponse.json({
        ok: false,
        status: "not_configured",
        message: "HIS_API_KEY 환경변수 미설정",
        hisUrl,
      });
    }

    const start = Date.now();
    try {
      const res = await fetch(`${hisUrl}/api/health`, {
        headers: { "Authorization": `Bearer ${hisApiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      const latency = Date.now() - start;

      if (res.ok) {
        return NextResponse.json({
          ok: true,
          status: "connected",
          latency,
          hisUrl,
        });
      }

      return NextResponse.json({
        ok: false,
        status: "error",
        httpStatus: res.status,
        latency,
        hisUrl,
      });
    } catch (err) {
      const latency = Date.now() - start;
      return NextResponse.json({
        ok: false,
        status: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable",
        latency,
        hisUrl,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  } catch (err) {
    return handleError(err);
  }
}
