// Created: 2026-03-05
// Updated: 2026-04-06 — Cloudflare CF-Connecting-IP 헤더 우선 처리
// Edge runtime 호환 IP 추출 유틸리티
// pg 등 Node.js 전용 모듈을 import하지 않아 middleware(Edge)에서 안전하게 사용 가능

import { NextRequest } from "next/server";

/**
 * 요청 IP 추출 (CF-Connecting-IP 우선, XFF 스푸핑 방어)
 * - CF-Connecting-IP: Cloudflare가 직접 설정 (엣지에서 스푸핑 불가, 가장 신뢰)
 * - X-Real-IP: Nginx real_ip 모듈이 CF-Connecting-IP로부터 복원한 IP
 * - X-Forwarded-For: 클라이언트가 앞부분을 위조 가능 → 가장 오른쪽(프록시 추가) IP 사용
 */
export function getClientIp(request: NextRequest): string {
  // 1순위: Cloudflare 직접 설정 헤더 (Nginx CF IP 화이트리스트 적용 시 스푸핑 불가)
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // 2순위: Nginx real_ip 모듈이 복원한 실제 IP
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  // 3순위: X-Forwarded-For 마지막 항목 (프록시가 추가한 가장 신뢰할 수 있는 값)
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim()).filter(Boolean);
    return ips[ips.length - 1] || "unknown";
  }

  // Next.js 내장 IP (Edge runtime 또는 직접 연결 시 유효)
  const socketIp = (request as unknown as { ip?: string }).ip;
  if (socketIp) return socketIp;

  return "unknown";
}
