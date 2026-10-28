// Created: 2026-06-01
// 환자 개인정보 마스킹 유틸 — 의료법/개인정보보호법 준수

/** 이름 마스킹: 홍길동 → 홍*동, 김수 → 김*, AB → A* */
export function maskName(name: string): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  if (trimmed.length === 2) return trimmed[0] + "*";
  return trimmed[0] + "*".repeat(trimmed.length - 2) + trimmed[trimmed.length - 1];
}
