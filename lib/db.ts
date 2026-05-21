import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";

const globalForPool = globalThis as unknown as { mysqlPool: Pool };

function createPool(): Pool {
  const host = process.env.MYSQL_HOST;
  if (!host) throw new Error("MYSQL_HOST environment variable is not set");
  return mysql.createPool({
    host,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    waitForConnections: true,
    connectionLimit: 15,
    charset: "utf8mb4",
    ssl: { rejectUnauthorized: false },
  });
}

export const pool = globalForPool.mysqlPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForPool.mysqlPool = pool;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = Record<string, any>>(
  sql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[] = []
): Promise<T[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, args);
  return rows as unknown as T[];
}

/** Use for INSERT/UPDATE/DELETE when you need insertId or affectedRows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function execute(sql: string, args: any[] = []): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await pool.execute<ResultSetHeader>(sql, args);
  return { insertId: result.insertId, affectedRows: result.affectedRows };
}
