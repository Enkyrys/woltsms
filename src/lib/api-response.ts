import { NextResponse } from "next/server";

export function ok<T>(data?: T, message = "OK") {
  return NextResponse.json({ success: true, code: 200, message, data: data ?? null });
}

export function fail(code: number, message: string, data: unknown = null) {
  return NextResponse.json({ success: false, code, message, data }, { status: code });
}

export function paginated<T>(rows: T[], total: number, page: number, perPage: number) {
  return NextResponse.json({
    success: true,
    code: 200,
    message: "OK",
    data: rows,
    meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) },
  });
}
