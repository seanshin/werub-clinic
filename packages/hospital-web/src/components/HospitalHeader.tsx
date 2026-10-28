// Created: 2026-05-06
"use client";
import Link from "next/link";
import { Bell, User } from "lucide-react";
import { hfetch } from "@/lib/api";

interface Props {
  hospitalName?: string;
  showNav?: boolean;
  unreadCount?: number;
}

export function HospitalHeader({ hospitalName, showNav = false, unreadCount = 0 }: Props) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={showNav ? "/dashboard" : "/"} className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-xs font-black shadow-sm">W</div>
            <span className="font-bold text-gray-900">W.Clinic</span>
          </Link>
          {hospitalName && (
            <>
              <span className="text-gray-300">|</span>
              <span className="text-sm text-gray-500">{hospitalName}</span>
            </>
          )}
        </div>
        {showNav ? (
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={async () => {
              try {
                const res = await hfetch("/api/clinic/sso/token", {
                  method: "POST",
                  body: JSON.stringify({ targetService: "his" }),
                });
                const data = await res.json();
                if (data.redirectUrl) {
                  window.open(data.redirectUrl, "_blank");
                } else {
                  alert("SSO 토큰 생성 실패: " + (data.error ?? "알 수 없는 오류"));
                }
              } catch {
                window.open("https://his.example.org", "_blank");
              }
            }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
              title="HIS 병원정보시스템 (SSO 로그인)">
              <span className="text-sm">🏥</span>
              <span className="text-xs font-bold text-blue-600 hidden sm:inline">HIS</span>
            </button>
            <Link href="/notifications" className="relative p-2 text-gray-400 hover:text-gray-600 transition-colors">
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            <Link href="/profile" className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
              <User size={18} />
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <a href="https://example.org/landing" className="hidden sm:block px-2 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors">WeRU.B</a>
            <a href="https://work.example.org" className="hidden sm:block px-2 py-1.5 text-xs font-medium text-violet-500 hover:text-violet-700 transition-colors">W.Work</a>
            <a href="https://channel.example.org" className="hidden sm:block px-2 py-1.5 text-xs font-medium text-indigo-500 hover:text-indigo-700 transition-colors">W.Channel</a>
            <a href="https://vibe.example.org" className="hidden sm:block px-2 py-1.5 text-xs font-medium text-pink-500 hover:text-pink-700 transition-colors">Vibe</a>
            <Link href="/login" className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">로그인</Link>
            <Link href="/register" className="px-5 py-2.5 text-sm font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20">시작하기</Link>
          </div>
        )}
      </div>
    </header>
  );
}
