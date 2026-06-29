// ChessGuru admin allowlist. Override with env CHESSGURU_ADMINS="user1,user2".
export const ADMIN_USERS = (process.env.CHESSGURU_ADMINS || "Ranjith_vsk").split(",").map((s) => s.trim()).filter(Boolean);
export const isAdmin = (userId?: string | null): boolean => !!userId && ADMIN_USERS.includes(userId);
