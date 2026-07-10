import { Pool } from "pg";

// Un solo pool reusado entre invocaciones (importante en serverless:
// evita abrir una conexion nueva por request).
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("Falta DATABASE_URL en las variables de entorno.");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const { rows } = await getPool().query(text, params);
  return rows as T[];
}
