// Created: 2026-05-19
// Updated: 2026-07-21 — 월/주/일 뷰 전환 + calendar_events 필드 매핑 수정(start_at/event_type)
// 부서별 근무/공지 통합 캘린더
"use client";
import { maskName } from "@/lib/mask";

import { useState, useEffect, useMemo } from "react";
import { HospitalHeader } from "@/components/HospitalHeader";
import { HospitalFooter } from "@/components/HospitalFooter";
import { hfetch } from "@/lib/api";
import { fetchDutyMonth, fetchSurgeryToday } from "@/lib/workgroup";
import { Calendar, ChevronLeft, ChevronRight as ChevronRightIcon, Loader2, Plus, X } from "lucide-react";
import { clinicContextUrl } from "@/lib/clinic-context";

type ViewMode = "month" | "week" | "day";

interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  type: "duty_day" | "duty_night" | "duty_er" | "surgery" | "notice" | "meeting" | "event" | "deadline";
  title: string;
  detail?: string;
  color: string;
}

const EVENT_COLORS: Record<string, string> = {
  duty_day: "#F59E0B",
  duty_night: "#6366F1",
  duty_er: "#EF4444",
  surgery: "#EC4899",
  notice: "#10B981",
  meeting: "#3B82F6",
  event: "#8B5CF6",
  deadline: "#F97316",
};

const EVENT_LABELS: Record<string, string> = {
  duty_day: "주간 당직",
  duty_night: "야간 당직",
  duty_er: "응급 당직",
  surgery: "수술",
  notice: "공지",
  meeting: "회의",
  event: "병원 일정",
  deadline: "업무 마감",
};

// calendar_events.event_type → 표시 타입 매핑 (DB CHECK: event/meeting/deadline/reminder/important/company/surgery/appointment/duty)
const CAL_TYPE_MAP: Record<string, CalendarEvent["type"]> = {
  meeting: "meeting",
  appointment: "meeting",
  reminder: "deadline",
  deadline: "deadline",
  event: "event",
  important: "event",
  company: "event",
  surgery: "surgery",
  duty: "duty_day",
};

// ── 날짜 유틸 ──────────────────────────────
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfWeek = (d: Date) => { const x = new Date(d); x.setDate(d.getDate() - d.getDay()); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(d.getDate() + n); return x; };
const monthsInRange = (start: Date, end: Date): string[] => {
  const set: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) { set.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`); cur.setMonth(cur.getMonth() + 1); }
  return set;
};

export default function WorkCalendarPage() {
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(new Date()); // 현재 보고 있는 기준 날짜
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  // 일정 추가 폼
  const [members, setMembers] = useState<{ userId: string; username: string; dept: string }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newAllDay, setNewAllDay] = useState(false);
  const [newStartTime, setNewStartTime] = useState("09:00");
  const [newEndTime, setNewEndTime] = useState("10:00");
  const [newType, setNewType] = useState("meeting");
  const [newLocation, setNewLocation] = useState("");
  const [newAttendees, setNewAttendees] = useState<string[]>([]);

  useEffect(() => {
    hfetch(clinicContextUrl()).then(r => r.ok ? r.json() : null).then(ctx => {
      if (ctx?.primary?.name) setHospitalName(ctx.primary.name);
      if (ctx?.primary?.slug) setSlug(ctx.primary.slug);
    }).catch(() => {});
  }, []);

  // 뷰 기준 표시 범위
  const range = useMemo(() => {
    if (view === "day") return { start: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()), end: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 23, 59, 59) };
    if (view === "week") { const s = startOfWeek(anchor); return { start: s, end: new Date(addDays(s, 6).setHours(23, 59, 59, 999)) }; }
    return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59) };
  }, [view, anchor]);

  // 데이터 로드 — 표시 범위가 걸치는 모든 월을 병합 조회(주 뷰가 월 경계를 넘는 경우 대응)
  useEffect(() => {
    setLoading(true);
    const months = monthsInRange(range.start, range.end);

    const dutyCalls = Promise.all(months.map(m => fetchDutyMonth(m)));
    // 캘린더 GET은 year·month를 분리된 숫자 파라미터로 받는다("2026-07" 통짜 전달 시 parseInt→2026 버그)
    const calCalls = slug ? Promise.all(months.map(m => { const [y, mo] = m.split("-"); return hfetch(`/api/cafes/${slug}/calendar?year=${y}&month=${Number(mo)}`).then(r => r.ok ? r.json() : null).catch(() => null); })) : Promise.resolve([]);
    const surgeryCall = fetchSurgeryToday();
    const noticeCall = slug ? hfetch(`/api/cafes/${slug}/posts?limit=20&isNotice=true`).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);

    Promise.all([dutyCalls, calCalls, surgeryCall, noticeCall]).then(([dutyResults, calResults, surgeriesResult, noticeData]) => {
      const evts: CalendarEvent[] = [];

      // 당직 (HIS)
      for (const dutyResult of dutyResults) {
        for (const day of dutyResult.data.schedules) {
          for (const shift of day.shifts) {
            const names = shift.staff.map(s => s.name).join(", ");
            if (names) {
              const t = `duty_${shift.shift}` as CalendarEvent["type"];
              evts.push({ id: `duty-${day.date}-${shift.shift}`, date: day.date, type: t,
                title: `${shift.shift === "day" ? "주간" : shift.shift === "night" ? "야간" : "응급"}: ${names}`,
                color: EVENT_COLORS[t] ?? EVENT_COLORS.duty_day });
            }
          }
        }
      }

      // 수술 (HIS, 오늘)
      const today = ymd(new Date());
      for (const s of surgeriesResult.data) {
        evts.push({ id: `surg-${s.id}`, date: today, type: "surgery",
          title: `${s.startTime} ${maskName(s.patientName)} — ${s.procedure}`,
          detail: `${s.operatingRoom} | 집도: ${s.surgeon}`, color: EVENT_COLORS.surgery });
      }

      // 캘린더 이벤트 (로컬 calendar_events) — 회의/병원일정/마감/수술 등
      for (const calData of calResults) {
        const calEvents = (calData?.events ?? []) as { id: string; title: string; start_at: string; event_type: string; color?: string | null; location?: string | null }[];
        for (const e of calEvents) {
          const t = CAL_TYPE_MAP[e.event_type] ?? "meeting";
          evts.push({ id: `cal-${e.id}`, date: (e.start_at ?? "").slice(0, 10), type: t, title: e.title,
            detail: e.location || undefined, color: e.color || EVENT_COLORS[t] });
        }
      }

      // 공지사항 (로컬 posts)
      const notices = (noticeData?.posts ?? noticeData?.pinnedPosts ?? []) as { id: string; title: string; createdAt: string }[];
      for (const n of notices) {
        evts.push({ id: `notice-${n.id}`, date: (n.createdAt ?? "").slice(0, 10), type: "notice", title: n.title, color: EVENT_COLORS.notice });
      }

      // id 중복 제거(월 경계 병합 시 중복 방지)
      const seen = new Set<string>();
      setEvents(evts.filter(e => e.date && !seen.has(e.id) && seen.add(e.id)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [range, slug, refreshKey]);

  // 참석자 후보(부서 정보 병합) 로드
  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const r = await hfetch(`/api/cafes/${slug}/members?limit=200`);
        const d = await r.json();
        const base = (d.members ?? []).map((m: { user: { id: string; username: string } }) => ({ userId: m.user.id, username: m.user.username, dept: "" }));
        try {
          const wr = await hfetch(`/api/cafes/${slug}/wsign/members`);
          const wd = await wr.json();
          const dm = new Map<string, string>((wd.members ?? []).map((m: { userId: string; dept: string }) => [m.userId, m.dept]));
          base.forEach((m: { userId: string; dept: string }) => { m.dept = dm.get(m.userId) || ""; });
        } catch { /* 조직 정보 없음 */ }
        setMembers(base);
      } catch { /* 무시 */ }
    })();
  }, [slug]);

  const resetAddForm = () => {
    setNewTitle(""); setNewDate(""); setNewAllDay(false); setNewStartTime("09:00");
    setNewEndTime("10:00"); setNewType("meeting"); setNewLocation(""); setNewAttendees([]);
  };
  const openAdd = () => {
    resetAddForm();
    setNewDate(ymd(selectedDate ? new Date(selectedDate) : anchor));
    setShowAdd(true);
  };
  const createEvent = async () => {
    if (!newTitle.trim() || !newDate || saving) return;
    setSaving(true);
    const dayStr = newDate;
    const payload: Record<string, unknown> = {
      title: newTitle.trim(), eventType: newType, allDay: newAllDay,
      startAt: newAllDay ? new Date(`${dayStr}T00:00:00`).toISOString() : new Date(`${dayStr}T${newStartTime}:00`).toISOString(),
    };
    if (!newAllDay) payload.endAt = new Date(`${dayStr}T${newEndTime}:00`).toISOString();
    if (newLocation.trim()) payload.location = newLocation.trim();
    if (newAttendees.length) payload.attendeeIds = newAttendees;
    try {
      const res = await hfetch(`/api/cafes/${slug}/calendar`, { method: "POST", body: JSON.stringify(payload) });
      if (res.ok) { setShowAdd(false); resetAddForm(); setRefreshKey(k => k + 1); }
    } finally { setSaving(false); }
  };
  const toggleAttendee = (id: string) => setNewAttendees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const addHourStr = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h + 1 > 23 ? "23:59" : `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };

  // ── 네비게이션 (뷰 단위 이동) ──────────────
  const goPrev = () => setAnchor(a => view === "month" ? new Date(a.getFullYear(), a.getMonth() - 1, 1) : addDays(a, view === "week" ? -7 : -1));
  const goNext = () => setAnchor(a => view === "month" ? new Date(a.getFullYear(), a.getMonth() + 1, 1) : addDays(a, view === "week" ? 7 : 1));
  const goToday = () => setAnchor(new Date());
  const todayStr = ymd(new Date());

  const headerLabel = useMemo(() => {
    if (view === "day") return anchor.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    if (view === "week") { const s = startOfWeek(anchor); const e = addDays(s, 6); return `${s.getMonth() + 1}/${s.getDate()} ~ ${e.getMonth() + 1}/${e.getDate()}`; }
    return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
  }, [view, anchor]);

  // 월 그리드
  const monthDays = useMemo(() => {
    const year = anchor.getFullYear(), month = anchor.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= lastDate; d++) days.push(d);
    return days;
  }, [anchor]);
  const getMonthDateStr = (day: number) => `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // 주 그리드 (7일)
  const weekDays = useMemo(() => { const s = startOfWeek(anchor); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }, [anchor]);

  const eventsOn = (dateStr: string) => events.filter(e => e.date === dateStr);
  const selectedEvents = selectedDate ? eventsOn(selectedDate) : [];
  const selectedTopColor = selectedEvents.length > 0 ? selectedEvents[0].color : null;
  const dayEvents = eventsOn(ymd(anchor)); // 일 뷰 대상
  const todayEvents = eventsOn(todayStr);
  const todayTypeCounts = todayEvents.reduce<Record<string, number>>((acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; }, {});

  const ViewToggle = () => (
    <div className="flex rounded-xl overflow-hidden bg-white/20">
      {(["month", "week", "day"] as ViewMode[]).map(v => (
        <button key={v} onClick={() => setView(v)}
          className={`px-2.5 py-1 text-xs font-bold transition-colors ${view === v ? "bg-white text-blue-600" : "text-white hover:bg-white/20"}`}>
          {v === "month" ? "월" : v === "week" ? "주" : "일"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <HospitalHeader showNav hospitalName={hospitalName} />
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* 헤더 */}
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 mb-6 shadow-lg shadow-blue-200/50">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <Calendar size={22} className="text-white" />
              </div>
              <h1 className="text-xl font-black text-white">근무 캘린더</h1>
            </div>
            <div className="flex items-center gap-3">
              <ViewToggle />
              <button onClick={goToday} className="px-2.5 py-1 text-xs font-bold text-white bg-white/20 hover:bg-white/30 rounded-xl transition-colors">오늘</button>
              <div className="flex items-center gap-1">
                <button onClick={goPrev} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><ChevronLeft size={20} className="text-white" /></button>
                <span className="text-sm font-bold text-white min-w-[7rem] text-center">{headerLabel}</span>
                <button onClick={goNext} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><ChevronRightIcon size={20} className="text-white" /></button>
              </div>
              <button onClick={openAdd} className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-white rounded-xl hover:bg-blue-50 transition-colors flex items-center gap-1 shadow-sm">
                <Plus size={14} /> 일정 추가
              </button>
            </div>
          </div>
        </div>

        {/* 범례 */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {Object.entries(EVENT_LABELS).map(([key, label]) => (
            <span key={key} className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: EVENT_COLORS[key] }} />
              {label}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={24} /></div>
        ) : (
          <div className="flex gap-4">
            <div className="flex-1 bg-white rounded-2xl border overflow-hidden shadow-sm">
              {/* ── 월 뷰 ── */}
              {view === "month" && (<>
                <div className="grid grid-cols-7 bg-gray-50 border-b">
                  {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                    <div key={d} className={`text-center py-2.5 text-[11px] font-bold ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-400"}`}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {monthDays.map((day, idx) => {
                    if (!day) { const colIdx = idx % 7; return <div key={`empty-${idx}`} className={`min-h-[80px] border-b border-r ${colIdx === 0 ? "bg-red-50/20" : colIdx === 6 ? "bg-blue-50/20" : "bg-gray-50/30"}`} />; }
                    const dateStr = getMonthDateStr(day);
                    const isToday = dateStr === todayStr;
                    const isSelected = dateStr === selectedDate;
                    const de = eventsOn(dateStr);
                    const dow = new Date(dateStr).getDay();
                    return (
                      <button key={dateStr} onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                        className={`min-h-[80px] border-b border-r p-1.5 text-left hover:bg-blue-50/50 transition-colors relative ${isSelected ? "bg-blue-50 ring-1 ring-blue-300" : ""} ${dow === 0 ? "bg-red-50/10" : dow === 6 ? "bg-blue-50/10" : ""}`}>
                        <div className={`text-[11px] font-semibold mb-1 ${isToday ? "w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center ring-2 ring-blue-300 ring-offset-1 shadow-sm" : dow === 0 ? "text-red-400" : dow === 6 ? "text-blue-400" : "text-gray-600"}`}>{day}</div>
                        <div className="space-y-0.5">
                          {de.slice(0, 3).map(e => (
                            <div key={e.id} className="flex items-center gap-1 text-[9px] leading-tight px-1 py-[2px] truncate">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: e.color }} />
                              <span className="truncate text-gray-600">{e.title.length > 10 ? e.title.slice(0, 10) + "…" : e.title}</span>
                            </div>
                          ))}
                          {de.length > 3 && <div className="text-[9px] text-gray-400 px-1 font-medium">+{de.length - 3}</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>)}

              {/* ── 주 뷰 ── */}
              {view === "week" && (<>
                <div className="grid grid-cols-7 bg-gray-50 border-b">
                  {weekDays.map((d, i) => (
                    <div key={i} className={`text-center py-2 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-500"}`}>
                      <div className="text-[10px] font-bold">{["일", "월", "화", "수", "목", "금", "토"][i]}</div>
                      <div className={`text-sm font-bold ${ymd(d) === todayStr ? "text-blue-600" : ""}`}>{d.getDate()}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 min-h-[380px]">
                  {weekDays.map((d, i) => {
                    const dateStr = ymd(d);
                    const de = eventsOn(dateStr);
                    return (
                      <div key={i} className={`border-r last:border-r-0 p-1.5 space-y-1 ${ymd(d) === todayStr ? "bg-blue-50/40" : i === 0 ? "bg-red-50/10" : i === 6 ? "bg-blue-50/10" : ""}`}>
                        {de.length === 0 && <div className="text-[9px] text-gray-300 text-center pt-2">·</div>}
                        {de.map(e => (
                          <div key={e.id} className="rounded-md px-1.5 py-1 text-[9px] leading-tight" style={{ background: e.color + "12", borderLeft: `2px solid ${e.color}` }}>
                            <span className="font-semibold" style={{ color: e.color }}>{EVENT_LABELS[e.type]}</span>
                            <div className="text-gray-700 truncate">{e.title}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>)}

              {/* ── 일 뷰 ── */}
              {view === "day" && (
                <div className="p-5">
                  <h3 className="text-sm font-bold text-gray-900 mb-4">{anchor.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })} · 일정 {dayEvents.length}건</h3>
                  {dayEvents.length === 0 ? (
                    <p className="text-xs text-gray-400 py-12 text-center">이 날짜에 등록된 일정이 없습니다</p>
                  ) : (
                    <div className="space-y-2">
                      {dayEvents.map(e => (
                        <div key={e.id} className="rounded-lg px-4 py-3" style={{ borderLeft: `3px solid ${e.color}`, background: e.color + "08" }}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: e.color }} />
                            <span className="text-[10px] font-semibold" style={{ color: e.color }}>{EVENT_LABELS[e.type] ?? e.type}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-800 leading-snug">{e.title}</p>
                          {e.detail && <p className="text-[11px] text-gray-500 mt-1">{e.detail}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 우측 패널 (월/주 뷰: 선택 상세 + 오늘 요약) */}
            {view !== "day" && (
              <div className="w-72 shrink-0">
                {selectedDate ? (
                  <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                    {selectedTopColor && <div className="h-1.5" style={{ background: `linear-gradient(to right, ${selectedTopColor}, ${selectedTopColor}88)` }} />}
                    <div className="p-4">
                      <h3 className="text-sm font-bold text-gray-900 mb-3">{new Date(selectedDate).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}</h3>
                      {selectedEvents.length === 0 ? (
                        <p className="text-xs text-gray-400 py-4 text-center">일정 없음</p>
                      ) : (
                        <div className="space-y-2.5">
                          {selectedEvents.map(e => (
                            <div key={e.id} className="rounded-lg px-3 py-2.5" style={{ borderLeft: `3px solid ${e.color}`, background: e.color + "08" }}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: e.color }} />
                                <span className="text-[10px] font-semibold" style={{ color: e.color }}>{EVENT_LABELS[e.type] ?? e.type}</span>
                              </div>
                              <p className="text-xs font-medium text-gray-800 leading-snug">{e.title}</p>
                              {e.detail && <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">{e.detail}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border p-4 text-center shadow-sm">
                    <Calendar size={24} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-xs text-gray-400">날짜를 선택하면<br />상세 일정이 표시됩니다</p>
                  </div>
                )}

                <div className="mt-4 bg-white rounded-2xl border p-4 shadow-sm">
                  <h4 className="text-xs font-bold text-gray-500 mb-3">오늘 요약</h4>
                  {todayEvents.length >= 3 && Object.keys(todayTypeCounts).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {Object.entries(todayTypeCounts).map(([type, count]) => (
                        <span key={type} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: (EVENT_COLORS[type] ?? "#999") + "15", color: EVENT_COLORS[type] ?? "#999" }}>
                          {EVENT_LABELS[type] ?? type}
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[9px]" style={{ background: EVENT_COLORS[type] ?? "#999" }}>{count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {todayEvents.map(e => (
                      <div key={e.id} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: e.color }} />
                        <span className="text-[10px] text-gray-600 truncate">{e.title}</span>
                      </div>
                    ))}
                    {todayEvents.length === 0 && <p className="text-[10px] text-gray-300">오늘 일정 없음</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 일정 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white rounded-t-2xl">
              <h3 className="text-base font-bold text-gray-900">일정 추가</h3>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-3">
              <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="일정 제목"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-200 outline-none" autoFocus />

              {/* 시간 지정 / 종일 토글 */}
              <div className="flex gap-1 p-0.5 rounded-lg bg-gray-100 w-fit text-xs">
                <button type="button" onClick={() => setNewAllDay(false)}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${!newAllDay ? "bg-white shadow-sm text-blue-600" : "text-gray-500"}`}>🕐 시간 지정</button>
                <button type="button" onClick={() => setNewAllDay(true)}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${newAllDay ? "bg-white shadow-sm text-blue-600" : "text-gray-500"}`}>📅 종일</button>
              </div>

              {newAllDay ? (
                <label className="flex flex-col gap-1 text-[11px] text-gray-500">날짜
                  <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </label>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="col-span-2 flex flex-col gap-1 text-[11px] text-gray-500">날짜
                    <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-gray-500">시작 시간
                    <input type="time" value={newStartTime} step={300}
                      onChange={e => { setNewStartTime(e.target.value); if (newEndTime <= e.target.value) setNewEndTime(addHourStr(e.target.value)); }}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-gray-500">종료 시간
                    <input type="time" value={newEndTime} step={300} min={newStartTime}
                      onChange={e => setNewEndTime(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[11px] text-gray-500">구분
                  <select value={newType} onChange={e => setNewType(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    <option value="meeting">🤝 회의</option>
                    <option value="event">🏥 병원 일정</option>
                    <option value="deadline">⏰ 마감</option>
                    <option value="appointment">📌 예약</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-gray-500">장소 (선택)
                  <input type="text" value={newLocation} onChange={e => setNewLocation(e.target.value)} placeholder="예: 3층 회의실"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </label>
              </div>

              {/* 참석자 — 부서별 그룹 */}
              {members.length > 0 && (() => {
                const groups = new Map<string, typeof members>();
                for (const m of members) {
                  const key = m.dept?.trim() || "부서 미지정";
                  const arr = groups.get(key) ?? [];
                  arr.push(m);
                  groups.set(key, arr);
                }
                const ordered = [...groups.entries()].sort((a, b) =>
                  a[0] === "부서 미지정" ? 1 : b[0] === "부서 미지정" ? -1 : a[0].localeCompare(b[0], "ko"));
                return (
                  <div>
                    <div className="text-[11px] text-gray-500 mb-1.5">참석자 ({newAttendees.length}명 선택)</div>
                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1 border border-gray-100 rounded-lg p-2">
                      {ordered.map(([dept, list]) => {
                        const ids = list.map(m => m.userId);
                        const allSel = ids.every(id => newAttendees.includes(id));
                        return (
                          <div key={dept}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] font-semibold text-gray-700">{dept}</span>
                              <span className="text-[10px] text-gray-400">({list.length})</span>
                              <button type="button"
                                onClick={() => setNewAttendees(prev => allSel ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])])}
                                className="text-[10px] text-blue-600 hover:underline">{allSel ? "전체 해제" : "부서 전체"}</button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {list.map(m => (
                                <button key={m.userId} type="button" onClick={() => toggleAttendee(m.userId)}
                                  className={`px-2 py-1 text-[11px] rounded-full border transition-colors ${
                                    newAttendees.includes(m.userId) ? "bg-blue-600 text-white border-blue-600" : "text-gray-500 border-gray-200 hover:bg-gray-100"}`}>
                                  {m.username}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">취소</button>
                <button onClick={createEvent} disabled={saving || !newTitle.trim() || !newDate}
                  className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "저장 중…" : "생성"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <HospitalFooter />
    </div>
  );
}
