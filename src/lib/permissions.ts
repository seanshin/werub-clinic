// Created: 2026-02-19
// 카페 역할/권한 유틸리티

export const ROLE_LEVEL: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  STAFF: 4,
  REGULAR: 3,
  ASSOCIATE: 2,
  NEWBIE: 1,
};

export const ROLE_LABELS: Record<string, string> = {
  OWNER: "소유자",
  MANAGER: "매니저",
  STAFF: "스탭",
  REGULAR: "정회원",
  ASSOCIATE: "부회원",
  NEWBIE: "신입회원",
};

export const ASSIGNABLE_ROLES = ["MANAGER", "STAFF", "REGULAR", "ASSOCIATE", "NEWBIE"] as const;

export function roleLevel(role: string): number {
  return ROLE_LEVEL[role] ?? 0;
}

export function hasMinRole(userRole: string, minRole: string): boolean {
  return roleLevel(userRole) >= roleLevel(minRole);
}

export function canManageMembers(role: string): boolean {
  return hasMinRole(role, "MANAGER");
}

export function canManageCategories(role: string): boolean {
  return hasMinRole(role, "MANAGER");
}

export function canInviteMembers(role: string): boolean {
  return hasMinRole(role, "MANAGER");
}

export function canWriteNotice(role: string): boolean {
  return hasMinRole(role, "STAFF");
}

export function canStartElection(role: string): boolean {
  return role === "OWNER";
}

export function canNominate(role: string): boolean {
  return hasMinRole(role, "REGULAR");
}

export function canWriteToCategory(
  userRole: string,
  categoryPermissions: Record<string, unknown>,
  userId?: string,
): boolean {
  // 비공개 게시판: 지정 멤버만 (OWNER/MANAGER는 항상 접근)
  if (categoryPermissions?.isPrivate) {
    if (hasMinRole(userRole, "MANAGER")) return true;
    const allowed = (categoryPermissions.allowedMembers as string[]) || [];
    if (!userId || !allowed.includes(userId)) return false;
  }
  const writeRole = (categoryPermissions?.writeRole as string) || "NEWBIE";
  return hasMinRole(userRole, writeRole);
}

/** 비공개 게시판 접근 가능 여부 (조회 포함) */
export function canAccessCategory(
  userRole: string,
  categoryPermissions: Record<string, unknown>,
  userId?: string,
): boolean {
  if (!categoryPermissions?.isPrivate) return true;
  if (hasMinRole(userRole, "MANAGER")) return true;
  const allowed = (categoryPermissions.allowedMembers as string[]) || [];
  return !!userId && allowed.includes(userId);
}
