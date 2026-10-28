// Created: 2026-05-18
// Updated: 2026-05-20 — hisProxy 공통 헬퍼 적용
// GET/POST/PATCH/PUT /api/clinic/his/workgroup/:path* — HIS Workgroup API 프록시
import { NextRequest } from "next/server";
import { hisProxy } from "@/lib/his/proxy";

function proxy(request: NextRequest) {
  return hisProxy(request, { pathPrefix: "/api/clinic/his/workgroup", hisPrefix: "/api/workgroup" });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
