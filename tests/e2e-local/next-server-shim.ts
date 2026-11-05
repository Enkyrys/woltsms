// Test için next/server'ın kullanılan alt kümesi
export class NextResponse extends Response {
  cookies = {
    set: (name: string, value: string, o: { maxAge?: number; path?: string; httpOnly?: boolean } = {}) => {
      this.headers.append("set-cookie", `${name}=${value}; Path=${o.path ?? "/"}${o.maxAge !== undefined ? `; Max-Age=${o.maxAge}` : ""}${o.httpOnly ? "; HttpOnly" : ""}`);
    },
  };
  static json(body: unknown, init?: ResponseInit) {
    const r = new NextResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    return r;
  }
}
export function after(fn: () => unknown) { void Promise.resolve().then(fn); }
