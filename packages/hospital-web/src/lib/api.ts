// Created: 2026-05-06
// Updated: 2026-05-12 — @werub/api-core 적용 (401 재시도 버그 수정)

import { createApiClient } from "@werub/api-core";

export const hfetch = createApiClient({
  service: "clinic",
  onUnauthorized: () => {
    if (typeof window !== "undefined") window.location.href = "/login";
  },
});
