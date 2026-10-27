// Prisma error codes, e.g. P2002 (unique violation), P2003 (foreign key), P2025 (record not found).
export const hasCode = (error: unknown, code: string) => (error as { code?: unknown } | null)?.code === code;
