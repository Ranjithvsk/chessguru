// ChessGuru admin allowlist. session.userId is the user's _id = username.toLowerCase(),
// so match case-insensitively. Override with env CHESSGURU_ADMINS="user1,user2".
export const ADMIN_USERS = (process.env.CHESSGURU_ADMINS || "Ranjith_vsk").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (userId?: string | null): boolean => !!userId && ADMIN_USERS.includes(String(userId).toLowerCase());
