import { createClient, type Client, type InArgs } from "@libsql/client";

const globalForDb = globalThis as unknown as { db: Client };

function createDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL environment variable is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

export const db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.db = db;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = Record<string, any>>(
  sql: string,
  args: InArgs = []
): Promise<T[]> {
  const result = await db.execute({ sql, args });
  return result.rows as unknown as T[];
}
