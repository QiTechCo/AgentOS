export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import sqlite3 from "sqlite3";

const DB_PATH = "/mnt/lxc102/root/.hermes/memory_store.db";

export async function GET(): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        resolve(NextResponse.json({ facts: [] }));
        return;
      }
    });

    db.all(
      "SELECT * FROM facts ORDER BY last_accessed_at DESC LIMIT 100",
      [],
      (err, rows) => {
        db.close();
        resolve(NextResponse.json({ facts: err ? [] : rows }));
      }
    );
  });
}
