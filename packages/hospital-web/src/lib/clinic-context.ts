// Created: 2026-08-19 14:05
// 병원 진입 컨텍스트 — 로그인 때 병원 코드로 확인한 병원을 "선호 병원"으로 기억해 /api/clinic/context?cafe= 로 전달.
// 서버가 소속을 검증한 뒤 primary로 삼는다(비소속·스테일이면 최초 가입 병원). 로그아웃 시 삭제.
// 배경(2026-08-19 진입로 점검): 두 병원 소속 사용자가 코드 Y로 로그인해도 항상 가장 오래된 X로 들어갔다.
const KEY = "clinic_preferred_cafe";

export function setPreferredClinic(slug: string): void {
  try { localStorage.setItem(KEY, slug); } catch {}
}
export function getPreferredClinic(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function clearPreferredClinic(): void {
  try { localStorage.removeItem(KEY); } catch {}
}
/** /api/clinic/context URL(선호 병원 동봉) */
export function clinicContextUrl(): string {
  const slug = getPreferredClinic();
  return slug ? `/api/clinic/context?cafe=${encodeURIComponent(slug)}` : "/api/clinic/context";
}
