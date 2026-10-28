// Created: 2026-05-06
// Hospital Web Root Layout
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "W.Clinic — 병원 플랫폼",
  description: "진료 관리 · 전자결재 · 채널 · 캘린더 · Wiki · 근무표. 병원을 위한 올인원 플랫폼.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      </head>
      <body className="antialiased bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
