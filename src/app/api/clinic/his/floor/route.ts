// Created: 2026-05-18
// Updated: 2026-05-20 — hisProxy 공통 헬퍼 적용
// GET /api/clinic/his/floor — HIS Floor API 프록시 (루트)
import { NextRequest } from "next/server";
import { hisProxy } from "@/lib/his/proxy";

export async function GET(request: NextRequest) {
  return hisProxy(request, { pathPrefix: "/api/clinic/his/floor", hisPrefix: "/api/floor" });
}
