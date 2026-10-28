// Created: 2026-03-19 16:00
// Updated: 2026-04-06 — jsonwebtoken → jose (Edge Runtime 호환, async)
// JWT 코어 — signToken, verifyToken, 2FA 토큰

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { UnauthorizedError } from "@/lib/errors";
import { EFFECTIVE_SECRET, AUTH_CONFIG } from "../config";

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  tokenVersion: number;
}

export interface TwoFactorPayload {
  userId: string;
  purpose: "2fa";
}

// HS256 시크릿 (TextEncoder — Node.js 18+ & Edge 모두 호환)
function getSecret(): Uint8Array {
  return new TextEncoder().encode(EFFECTIVE_SECRET);
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(AUTH_CONFIG.accessTokenExpiry)
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const p = payload as JWTPayload & JwtPayload;
    if (!p.userId || !p.email || !p.role) {
      throw new UnauthorizedError("유효하지 않은 토큰 페이로드입니다");
    }
    return {
      userId: p.userId,
      email: p.email,
      role: p.role,
      tokenVersion: (p.tokenVersion as number) ?? 0,
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("유효하지 않은 토큰입니다");
  }
}

export async function sign2FAToken(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: "2fa" } satisfies TwoFactorPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(AUTH_CONFIG.twoFactorTokenExpiry)
    .sign(getSecret());
}

export async function verify2FAToken(token: string): Promise<TwoFactorPayload> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const p = payload as JWTPayload & TwoFactorPayload;
    if (p.purpose !== "2fa") {
      throw new UnauthorizedError("유효하지 않은 2FA 토큰입니다");
    }
    return { userId: p.userId as string, purpose: "2fa" };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("2FA 토큰이 만료되었거나 유효하지 않습니다");
  }
}
