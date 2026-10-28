// Created: 2026-03-04
// 토큰/시크릿 관리 서비스 — AES-256-GCM 암호화, DB(site_settings) 저장, .env 폴백
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// ─── 토큰 레지스트리 ─────────────────────────────────────────────────
export interface TokenMeta {
  envKey: string;
  group: string;
  label: string;
  isSecret: boolean;   // true면 마스킹 표시
  readonly: boolean;    // true면 수정/삭제 불가 (JWT_SECRET)
}

export const TOKEN_GROUPS = [
  "AI 서비스",
  "텔레그램",
  "결제",
  "OAuth",
  "네이버 검색",
  "인증/보안",
  "이메일",
  "외부 서비스",
] as const;

export type TokenGroup = typeof TOKEN_GROUPS[number];

export const TOKEN_REGISTRY: TokenMeta[] = [
  // AI 서비스
  { envKey: "ANTHROPIC_API_KEY",       group: "AI 서비스",   label: "Anthropic API Key (Claude)", isSecret: true,  readonly: false },
  { envKey: "GEMINI_API_KEY",          group: "AI 서비스",   label: "Google Gemini API Key",      isSecret: true,  readonly: false },
  { envKey: "OPENAI_API_KEY",          group: "AI 서비스",   label: "OpenAI API Key",             isSecret: true,  readonly: false },
  { envKey: "OLLAMA_API_KEY",          group: "AI 서비스",   label: "Ollama GPU API Key (실시간)", isSecret: true,  readonly: false },
  { envKey: "OLLAMA_IMAC_API_KEY",     group: "AI 서비스",   label: "Ollama iMac API Key (배치)", isSecret: true,  readonly: false },
  { envKey: "CLAUDE_MODEL_SONNET",     group: "AI 서비스",   label: "Claude Sonnet 모델 ID",      isSecret: false, readonly: false },
  { envKey: "CLAUDE_MODEL_HAIKU",      group: "AI 서비스",   label: "Claude Haiku 모델 ID",       isSecret: false, readonly: false },
  // 텔레그램
  { envKey: "TELEGRAM_BOT_TOKEN",      group: "텔레그램",    label: "텔레그램 봇 토큰",           isSecret: true,  readonly: false },
  { envKey: "TELEGRAM_WEBHOOK_SECRET", group: "텔레그램",    label: "텔레그램 웹훅 시크릿",       isSecret: true,  readonly: false },
  // 결제
  { envKey: "TOSS_CLIENT_KEY",         group: "결제",       label: "Toss 클라이언트 키",         isSecret: false, readonly: false },
  { envKey: "TOSS_SECRET_KEY",         group: "결제",       label: "Toss 시크릿 키",            isSecret: true,  readonly: false },
  // OAuth
  { envKey: "GOOGLE_CLIENT_ID",        group: "OAuth",      label: "Google Client ID",          isSecret: false, readonly: false },
  { envKey: "GOOGLE_CLIENT_SECRET",    group: "OAuth",      label: "Google Client Secret",      isSecret: true,  readonly: false },
  { envKey: "NAVER_CLIENT_ID",         group: "OAuth",      label: "Naver Client ID",           isSecret: false, readonly: false },
  { envKey: "NAVER_CLIENT_SECRET",     group: "OAuth",      label: "Naver Client Secret",       isSecret: true,  readonly: false },
  { envKey: "FACEBOOK_CLIENT_ID",      group: "OAuth",      label: "Facebook Client ID",        isSecret: false, readonly: false },
  { envKey: "FACEBOOK_CLIENT_SECRET",  group: "OAuth",      label: "Facebook Client Secret",    isSecret: true,  readonly: false },
  // 네이버 검색
  { envKey: "NAVER_SEARCH_CLIENT_ID",     group: "네이버 검색", label: "네이버 검색 Client ID",     isSecret: false, readonly: false },
  { envKey: "NAVER_SEARCH_CLIENT_SECRET", group: "네이버 검색", label: "네이버 검색 Client Secret", isSecret: true,  readonly: false },
  // 인증/보안
  { envKey: "JWT_SECRET",              group: "인증/보안",   label: "JWT Secret (암호화 키 원본)", isSecret: true,  readonly: true },
  { envKey: "NEXTAUTH_SECRET",         group: "인증/보안",   label: "NextAuth Secret",           isSecret: true,  readonly: false },
  // 이메일
  { envKey: "EMAIL_SERVICE_URL",       group: "이메일",     label: "Email 서비스 URL (:4200)",   isSecret: false, readonly: false },
  { envKey: "EMAIL_SERVICE_SECRET",    group: "이메일",     label: "Email 서비스 S2S 시크릿",     isSecret: true,  readonly: false },
  { envKey: "SMTP_HOST",               group: "이메일",     label: "SMTP 호스트",                isSecret: false, readonly: false },
  { envKey: "SMTP_PORT",               group: "이메일",     label: "SMTP 포트",                 isSecret: false, readonly: false },
  { envKey: "SMTP_USER",               group: "이메일",     label: "SMTP 사용자",                isSecret: false, readonly: false },
  { envKey: "SMTP_PASS",               group: "이메일",     label: "SMTP 비밀번호",              isSecret: true,  readonly: false },
  { envKey: "SMTP_FROM",               group: "이메일",     label: "발신자 이메일",               isSecret: false, readonly: false },
  // 외부 서비스
  { envKey: "OPENWEATHER_API_KEY",     group: "외부 서비스", label: "OpenWeather API Key",         isSecret: true,  readonly: false },
  // ※ sign 문서 인증(WSIGN_DOCAUTH_*)은 워크스페이스별 설정 — 전자결재 설정 화면에서 관리.
  //    전역 폴백만 .env(WSIGN_DOCAUTH_URL/KEY)로 지정 가능(여기 미노출).
];

// ─── AES-256-GCM 암호화 ──────────────────────────────────────────────
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let _cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const base = process.env.JWT_SECRET;
  // C8 보안: salt를 환경변수에서 읽어 하드코딩 제거
  // SECRETS_SALT — 프로덕션 미설정 시 예측가능 salt 사용은 보안위험이라 fail-closed(throw). (보안 후속 #5)
  if (process.env.NODE_ENV === "production" && !process.env.SECRETS_SALT) {
    throw new Error("[secrets] SECRETS_SALT 미설정 — 프로덕션에서는 .env에 반드시 설정하세요");
  }
  const salt = process.env.SECRETS_SALT ?? "werub-secrets-salt";
  if (!base) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: JWT_SECRET is required for secret encryption");
    }
    console.warn("[secrets] JWT_SECRET 미설정 — 개발 전용 키 사용 중");
    _cachedKey = crypto.scryptSync("dev-secret-DO-NOT-USE-IN-PRODUCTION", salt, 32);
  } else {
    _cachedKey = crypto.scryptSync(base, salt, 32);
  }
  return _cachedKey;
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv(12) + tag(16) + ciphertext → base64
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encoded: string): string {
  const key = deriveKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

/** 공용 암복호화 헬퍼 — 동일 AES-256-GCM(JWT_SECRET+SECRETS_SALT). site_settings 외 저장소(예: wsign per-cafe 설정)에서 재사용. */
export function encryptValue(plaintext: string): string { return encrypt(plaintext); }
export function decryptValue(encoded: string): string { return decrypt(encoded); }

// ─── 인메모리 캐시 (5분 TTL) ─────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { value: string; expiry: number }>();

function cacheGet(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key: string, value: string): void {
  cache.set(key, { value, expiry: Date.now() + CACHE_TTL });
}

export function invalidateCache(envKey?: string): void {
  if (envKey) {
    cache.delete(envKey);
  } else {
    cache.clear();
  }
}

// ─── DB 키 프리픽스 ──────────────────────────────────────────────────
const DB_PREFIX = "secret:";

// ─── Public API ──────────────────────────────────────────────────────

/** DB에서 암호화된 값 조회 → 없으면 process.env 폴백 */
export async function getSecretValue(envKey: string): Promise<string | undefined> {
  // 캐시 확인
  const cached = cacheGet(envKey);
  if (cached !== undefined) return cached;

  // DB 조회
  const row = await prisma.siteSetting.findUnique({
    where: { key: `${DB_PREFIX}${envKey}` },
  });

  if (row && typeof row.value === "string") {
    try {
      const decrypted = decrypt(row.value);
      cacheSet(envKey, decrypted);
      return decrypted;
    } catch (err) {
      console.error(`[secrets] ${envKey}: DB 복호화 실패, .env 폴백으로 전환`, err);
    }
  }

  // .env 폴백
  const envVal = process.env[envKey];
  if (envVal) {
    cacheSet(envKey, envVal);
  } else if (process.env.NODE_ENV !== "production") {
    console.warn(`[secrets] ${envKey}: DB 미설정, .env 폴백`);
  }
  return envVal;
}

/** 마스킹된 토큰 목록 (그룹별) — 단일 쿼리로 모든 DB 값 조회 */
export async function listSecrets(): Promise<{
  groups: Record<string, { tokens: TokenListItem[] }>;
}> {
  // DB에서 모든 secret: 값을 한 번에 조회 (N+1 방지)
  const dbRows = await prisma.siteSetting.findMany({
    where: { key: { startsWith: DB_PREFIX } },
    select: { key: true, value: true },
  });
  const dbMap = new Map(dbRows.map((r) => [r.key.replace(DB_PREFIX, ""), r.value]));

  const groups: Record<string, { tokens: TokenListItem[] }> = {};

  for (const meta of TOKEN_REGISTRY) {
    if (!groups[meta.group]) {
      groups[meta.group] = { tokens: [] };
    }

    const dbValue = dbMap.get(meta.envKey);
    const envVal = process.env[meta.envKey];
    let source: "db" | "env" | "unset";
    let masked: string | null = null;

    if (dbValue !== undefined && typeof dbValue === "string") {
      source = "db";
      try {
        const val = decrypt(dbValue);
        masked = maskValue(val, meta.isSecret);
      } catch (err) {
        console.error(`[secrets] ${meta.envKey}: 복호화 실패`, err);
        masked = "[복호화 실패]";
      }
    } else if (envVal) {
      source = "env";
      masked = maskValue(envVal, meta.isSecret);
    } else {
      source = "unset";
    }

    groups[meta.group].tokens.push({
      envKey: meta.envKey,
      label: meta.label,
      isSecret: meta.isSecret,
      readonly: meta.readonly,
      source,
      masked,
    });
  }

  return { groups };
}

/** 시크릿 저장 (암호화 후 DB에 upsert) */
export async function setSecret(envKey: string, value: string): Promise<void> {
  const meta = TOKEN_REGISTRY.find((t) => t.envKey === envKey);
  if (!meta) throw new Error(`알 수 없는 토큰: ${envKey}`);
  if (meta.readonly) throw new Error(`읽기전용 토큰은 수정할 수 없습니다: ${envKey}`);

  const encrypted = encrypt(value);
  await prisma.siteSetting.upsert({
    where: { key: `${DB_PREFIX}${envKey}` },
    create: { key: `${DB_PREFIX}${envKey}`, value: encrypted },
    update: { value: encrypted },
  });
  invalidateCache(envKey);
}

/** DB 값 삭제 → .env 폴백으로 복원 */
export async function deleteSecret(envKey: string): Promise<void> {
  const meta = TOKEN_REGISTRY.find((t) => t.envKey === envKey);
  if (!meta) throw new Error(`알 수 없는 토큰: ${envKey}`);
  if (meta.readonly) throw new Error(`읽기전용 토큰은 삭제할 수 없습니다: ${envKey}`);

  await prisma.siteSetting.deleteMany({
    where: { key: `${DB_PREFIX}${envKey}` },
  });
  invalidateCache(envKey);
}

/** 복호화된 전체 값 반환 */
export async function revealSecret(envKey: string): Promise<string | null> {
  const meta = TOKEN_REGISTRY.find((t) => t.envKey === envKey);
  if (!meta) throw new Error(`알 수 없는 토큰: ${envKey}`);

  // DB 우선
  const row = await prisma.siteSetting.findUnique({
    where: { key: `${DB_PREFIX}${envKey}` },
  });
  if (row && typeof row.value === "string") {
    try {
      return decrypt(row.value);
    } catch (err) {
      console.error(`[secrets] ${envKey}: reveal 복호화 실패`, err);
      return null;
    }
  }

  // .env 폴백
  return process.env[envKey] ?? null;
}

// ─── 유틸 ────────────────────────────────────────────────────────────

export interface TokenListItem {
  envKey: string;
  label: string;
  isSecret: boolean;
  readonly: boolean;
  source: "db" | "env" | "unset";
  masked: string | null;
}

function maskValue(val: string, isSecret: boolean): string {
  if (!isSecret) return val;
  if (val.length <= 4) return "****";
  return "•".repeat(Math.min(val.length - 4, 20)) + val.slice(-4);
}
