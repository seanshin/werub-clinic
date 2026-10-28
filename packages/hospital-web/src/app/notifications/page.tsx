// Created: 2026-05-06
// Updated: 2026-05-19 — 알림 타입별 아이콘 + hospitalName 연동
// clinic.example.org/notifications — 알림
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { Loader2, ArrowLeft, CheckCheck, Bell, FileText, Calendar, MessageSquare, Users, AlertTriangle, Stethoscope } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";

interface Notification {
  id: string;
  type: string;
  title?: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  link?: string;
}

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
  SYSTEM: { icon: Bell, color: "text-gray-500", bg: "bg-gray-100" },
  WSIGN: { icon: FileText, color: "text-blue-500", bg: "bg-blue-50" },
  CALENDAR: { icon: Calendar, color: "text-orange-500", bg: "bg-orange-50" },
  CHANNEL: { icon: MessageSquare, color: "text-green-500", bg: "bg-green-50" },
  MENTION: { icon: Users, color: "text-indigo-500", bg: "bg-indigo-50" },
  ALERT: { icon: AlertTriangle, color: "text-red-500", bg: "bg-red-50" },
  HOSPITAL: { icon: Stethoscope, color: "text-emerald-500", bg: "bg-emerald-50" },
};

export default function NotificationsPage() {
  const router = useRouter();
  const [hospitalName, setHospitalName] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
    hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).then(ctx => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    hfetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => {
      if (!d?.user) { router.replace("/login"); return; }
      return hfetch("/api/notifications?limit=50").then(r => r.ok ? r.json() : { notifications: [] });
    }).then(d => {
      if (d?.notifications) setNotifications(d.notifications);
    }).catch(() => router.replace("/login")).finally(() => setLoading(false));
  }, [router]);

  const markAllRead = async () => {
    await hfetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const markRead = async (id: string) => {
    await hfetch(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;
  const filtered = filter === "unread" ? notifications.filter(n => !n.isRead) : notifications;

  // 날짜별 그룹핑
  const byDate: Record<string, Notification[]> = {};
  for (const n of filtered) {
    const dateKey = new Date(n.createdAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(n);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 text-emerald-500 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} unreadCount={unreadCount} />
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/dashboard")} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <Bell size={20} className="text-emerald-500" />
              <h1 className="text-lg font-bold text-gray-900">알림</h1>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{unreadCount}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 필터 */}
            <div className="inline-flex bg-gray-100 rounded-full p-0.5">
              <button onClick={() => setFilter("all")}
                className={`px-3 py-1 rounded-full text-[10px] font-medium ${filter === "all" ? "bg-white shadow text-gray-900" : "text-gray-400"}`}>
                전체
              </button>
              <button onClick={() => setFilter("unread")}
                className={`px-3 py-1 rounded-full text-[10px] font-medium ${filter === "unread" ? "bg-white shadow text-gray-900" : "text-gray-400"}`}>
                안읽음 {unreadCount > 0 && unreadCount}
              </button>
            </div>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-emerald-600 hover:bg-emerald-50 rounded-lg">
                <CheckCheck size={12} /> 모두 읽음
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-50 flex items-center justify-center">
              <Bell size={28} className="text-emerald-300" />
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">{filter === "unread" ? "안읽은 알림이 없습니다" : "알림이 없습니다"}</p>
            <p className="text-xs text-gray-300">새로운 알림이 오면 여기에 표시됩니다</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(byDate).map(([date, notifs]) => (
              <div key={date}>
                <h3 className="text-[10px] font-bold text-gray-400 mb-1.5 px-1">{date}</h3>
                <div className="space-y-1">
                  {notifs.map(n => {
                    const typeKey = Object.keys(TYPE_CONFIG).find(k => n.type.includes(k)) ?? "SYSTEM";
                    const cfg = TYPE_CONFIG[typeKey];
                    const Icon = cfg.icon;

                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          if (!n.isRead) markRead(n.id);
                          if (n.link) window.location.href = n.link;
                        }}
                        className={`w-full text-left bg-white rounded-xl border px-4 py-3 flex items-start gap-3 transition-all hover:shadow-sm ${
                          !n.isRead ? "border-l-3 border-l-emerald-500" : "border-gray-200"
                        }`}
                        style={{ borderLeftWidth: !n.isRead ? 3 : 1 }}
                      >
                        <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                          <Icon size={14} className={cfg.color} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {n.title && <p className="text-xs font-bold text-gray-700 mb-0.5">{n.title}</p>}
                          <p className={`text-sm leading-relaxed ${n.isRead ? "text-gray-500" : "text-gray-900"}`}>{n.message}</p>
                          <p className="text-[10px] text-gray-400 mt-1">
                            {new Date(n.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        {!n.isRead && <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-2" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <HospitalFooter />
    </div>
  );
}
