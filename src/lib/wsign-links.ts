// Created: 2026-06-09
// W.Channel ↔ 그룹웨어 전자결재 연동 링크 헬퍼
import { prisma } from "@/lib/prisma";

/** 이 cafe가 결재 원본(source)인 활성 링크 — 결재 카드 발행 대상 조회 */
export function getLinksForSource(cafeId: string) {
  return prisma.wsignWorkspaceLink.findMany({ where: { sourceCafeId: cafeId, active: true } });
}

/** 이 cafe가 연동 채널(channel)인 활성 링크 */
export function getLinksForChannel(cafeId: string) {
  return prisma.wsignWorkspaceLink.findMany({ where: { channelCafeId: cafeId, active: true } });
}

/**
 * 사용자가 채널 멤버인 워크스페이스들과 연결된 source cafeId 목록 (통합 배지/결재함용).
 * 사용자가 속한 cafe들이 channelCafe인 활성 링크의 sourceCafeId를 중복 제거해 반환.
 */
export async function getLinkedSourceCafeIds(userId: string): Promise<string[]> {
  const memberships = await prisma.cafeMember.findMany({ where: { userId }, select: { cafeId: true } });
  const cafeIds = memberships.map((m) => m.cafeId);
  if (cafeIds.length === 0) return [];
  const links = await prisma.wsignWorkspaceLink.findMany({
    where: { channelCafeId: { in: cafeIds }, active: true },
    select: { sourceCafeId: true },
  });
  return [...new Set(links.map((l) => l.sourceCafeId))];
}
