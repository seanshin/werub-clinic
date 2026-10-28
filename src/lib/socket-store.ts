// Created: 2026-03-03
// Socket.IO 연결 관리 스토어 — 단일 서버 배포 기준
// 기존 sse-store.ts와 동일 인터페이스 (notifyUser) 유지

import type { Server as IOServer } from "socket.io";
import { isHeartbeatOnline, getHeartbeatOnlineUserIds } from "./heartbeat-store";

const g = global as typeof global & {
  _socketIO?: IOServer;
  _userSockets?: Map<string, Set<string>>;
  _onlineUsers?: Map<string, number>;
};

if (!g._userSockets) g._userSockets = new Map();
if (!g._onlineUsers) g._onlineUsers = new Map();

const userSockets = g._userSockets;
const onlineUsers = g._onlineUsers;

const MAX_SOCKETS_PER_USER = 5;

/** IO 인스턴스 저장/조회 */
export function setIO(io: IOServer) { g._socketIO = io; }
export function getIO(): IOServer | null { return g._socketIO ?? null; }

/** 소켓 연결 등록 */
export function addConnection(userId: string, socketId: string) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  const sids = userSockets.get(userId)!;

  // 상한 초과 시 가장 오래된 연결 강제 해제 (Array 변환으로 삽입 순서 명시)
  if (sids.size >= MAX_SOCKETS_PER_USER) {
    const sidsArray = Array.from(sids);
    const oldest = sidsArray[0];
    if (oldest) {
      const io = getIO();
      io?.sockets.sockets.get(oldest)?.disconnect(true);
      sids.delete(oldest);
    }
  }
  sids.add(socketId);
}

/** 소켓 연결 해제 */
export function removeConnection(userId: string, socketId: string) {
  userSockets.get(userId)?.delete(socketId);
  if (userSockets.get(userId)?.size === 0) userSockets.delete(userId);
}

/** 특정 유저에게 이벤트 전송 — sse-store.notifyUser와 동일 시그니처 */
export function notifyUser(userId: string, event: string, data: object) {
  const io = getIO();
  if (!io) return;

  const sids = userSockets.get(userId);
  if (!sids || sids.size === 0) return;

  for (const sid of sids) {
    io.to(sid).emit(event, data);
  }
}

/** presence room 참가 — 온라인 상태 변경을 수신할 소켓만 등록 */
export function joinPresenceRoom(socketId: string) {
  getIO()?.sockets.sockets.get(socketId)?.join("presence");
}

/** 온라인 상태 관리 — presence room 구독자에게만 전송 */
export function setOnline(userId: string) {
  const count = (onlineUsers.get(userId) ?? 0) + 1;
  onlineUsers.set(userId, count);
  if (count === 1) {
    getIO()?.to("presence").emit("user_online", { userId, isOnline: true });
  }
}

export function setOffline(userId: string) {
  const count = (onlineUsers.get(userId) ?? 1) - 1;
  if (count <= 0) {
    onlineUsers.delete(userId);
    getIO()?.to("presence").emit("user_online", { userId, isOnline: false });
  } else {
    onlineUsers.set(userId, count);
  }
}

const ALWAYS_ONLINE_BOTS = new Set(["wibi_bot_001"]);

export function isOnline(userId: string): boolean {
  return ALWAYS_ONLINE_BOTS.has(userId) || onlineUsers.has(userId) || isHeartbeatOnline(userId);
}

export function getOnlineUserIds(): string[] {
  return [...new Set([...onlineUsers.keys(), ...getHeartbeatOnlineUserIds()])];
}
