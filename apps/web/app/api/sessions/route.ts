export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import sqlite3 from "sqlite3";

const DB_PATH = "/mnt/lxc102/root/.hermes/state.db";

export async function GET(): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        resolve(NextResponse.json({ sessions: [], messages: 0 }));
        return;
      }
    });

    db.all(
      `SELECT 
        id as session_id, source, title, started_at, ended_at,
        message_count, tool_call_count, input_tokens, output_tokens,
        model, estimated_cost_usd, actual_cost_usd
       FROM sessions 
       WHERE archived = 0
       ORDER BY started_at DESC 
       LIMIT 50`,
      [],
      (err, rows) => {
        if (err) {
          db.get("SELECT count(*) as total FROM messages", [], (e2, meta: any) => {
            db.close();
            resolve(NextResponse.json({ sessions: [], messages: meta?.total ?? 0 }));
          });
          return;
        }
        db.get("SELECT count(*) as total FROM messages", [], (e2, meta: any) => {
          db.close();
          resolve(
            NextResponse.json({
              sessions: rows || [],
              messages: meta?.total ?? 0,
            })
          );
        });
      }
    );
  });
}
