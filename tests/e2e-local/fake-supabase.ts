// Test için: supabase-js admin istemcisinin worker'ın kullandığı alt kümesini yerel Postgres'e (psql) bağlar.
import { execFileSync } from "node:child_process";

export function sql(q: string): string {
  return execFileSync("psql", ["-h", process.env.PGHOST || "/var/tmp/pgsock", "-p", process.env.PGPORT || "5499", "-U", process.env.PGUSER || "postgres", "-d", process.env.PGDATABASE || "postgres", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", q], { encoding: "utf8" }).trim();
}
const lit = (v: unknown): string =>
  v === null || v === undefined ? "null" : `'${String(typeof v === "object" ? JSON.stringify(v) : v).replace(/'/g, "''")}'`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

class Query {
  private filters: string[] = [];
  private orderBy = "";
  private lim = "";
  private cols = "*";
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Record<string, unknown> | Record<string, unknown>[] = {};
  private conflict = "";
  private single = false;
  constructor(private table: string) {}
  select(c = "*") { if (this.op === "select") this.cols = c; return this; }
  eq(c: string, v: unknown) { this.filters.push(`${ident(c)} = ${lit(v)}`); return this; }
  neq(c: string, v: unknown) { this.filters.push(`${ident(c)} <> ${lit(v)}`); return this; }
  gt(c: string, v: unknown) { this.filters.push(`${ident(c)} > ${lit(v)}`); return this; }
  gte(c: string, v: unknown) { this.filters.push(`${ident(c)} >= ${lit(v)}`); return this; }
  lt(c: string, v: unknown) { this.filters.push(`${ident(c)} < ${lit(v)}`); return this; }
    is(c: string, v: unknown) { this.filters.push(`${ident(c)} is ${v === null ? "null" : String(v)}`); return this; }
  in(c: string, vs: unknown[]) { this.filters.push(vs.length ? `${ident(c)} in (${vs.map(lit).join(",")})` : "false"); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orderBy = ` order by ${ident(c)} ${o?.ascending === false ? "desc" : "asc"}`; return this; }
  limit(n: number) { this.lim = ` limit ${n}`; return this; }
  maybeSingle() { this.single = true; this.lim = " limit 1"; return this; }
  insert(p: Record<string, unknown> | Record<string, unknown>[]) { this.op = "insert"; this.payload = p; return this; }
  update(p: Record<string, unknown>) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Record<string, unknown>, o?: { onConflict?: string }) { this.op = "upsert"; this.payload = p; this.conflict = o?.onConflict ?? "id"; return this; }
  private where() { return this.filters.length ? ` where ${this.filters.join(" and ")}` : ""; }
  private exec(): { data: unknown; error: null | { message: string } } {
    try {
      const t = `public.${ident(this.table)}`;
      if (this.op === "select") {
        const out = sql(`select coalesce(json_agg(x), '[]') from (select ${this.cols === "*" ? "*" : this.cols} from ${t}${this.where()}${this.orderBy}${this.lim}) x`);
        const rows = JSON.parse(out || "[]");
        return { data: this.single ? rows[0] ?? null : rows, error: null };
      }
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      if (this.op === "update") {
        const set = Object.entries(rows[0]).map(([k, v]) => `${ident(k)} = ${lit(v)}`).join(", ");
        sql(`update ${t} set ${set}${this.where()}`);
        return { data: null, error: null };
      }
      for (const r of rows) {
        const ks = Object.keys(r);
        const ins = `insert into ${t} (${ks.map(ident).join(",")}) values (${ks.map((k) => lit(r[k])).join(",")})`;
        sql(this.op === "upsert" ? `${ins} on conflict (${this.conflict}) do update set ${ks.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}` : ins);
      }
      return { data: null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }
  then<A, B>(ok: (v: { data: unknown; error: null | { message: string } }) => A, ko?: (e: unknown) => B) {
    return Promise.resolve(this.exec()).then(ok, ko);
  }
}

const SETOF = new Set(["rpc_claim_send_batch"]);
const client = {
  from: (t: string) => new Query(t),
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    try {
      const a = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
      const out = SETOF.has(name)
        ? sql(`select coalesce(json_agg(t), '[]') from public.${name}(${a}) t`)
        : sql(`select to_jsonb(public.${name}(${a}))`);
      return { data: out ? JSON.parse(out) : null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  },
};
export function createAdminClient() { return client; }
export async function createClient() { return client; }
