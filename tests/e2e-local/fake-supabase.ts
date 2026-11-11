// Test için: supabase-js admin istemcisinin worker'ın kullandığı alt kümesini yerel Postgres'e (psql) bağlar.
import { execFileSync } from "node:child_process";

export function sql(q: string, uid = ""): string {
  // uid: auth.uid() için bağlantı ayarı (request.jwt.claim.sub)
  const env = { ...process.env, PGOPTIONS: `-c request.jwt.claim.sub=${uid.replace(/[^0-9a-f-]/gi, "")}` };
  return execFileSync("psql", ["-h", process.env.PGHOST || "/var/tmp/pgsock", "-p", process.env.PGPORT || "5499", "-U", process.env.PGUSER || "postgres", "-d", process.env.PGDATABASE || "postgres", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", q], { encoding: "utf8", env }).trim();
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
  lte(c: string, v: unknown) { this.filters.push(`${ident(c)} <= ${lit(v)}`); return this; }
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
const ARRAY_ARGS = new Set(["p_order_ids"]);

// Supabase Auth Admin API taklidi: auth.users üzerinde, şifreler pgcrypto (bcrypt) ile
type AuthUser = { id: string; email: string; user_metadata: Record<string, unknown> };
const authUser = (id: string): AuthUser | null => {
  const out = sql(`select json_build_object('id', id, 'email', email, 'user_metadata', coalesce(raw_user_meta_data, '{}'::jsonb)) from auth.users where id = ${lit(id)}`);
  return out ? JSON.parse(out) : null;
};
const authAdmin = {
  getUserById: async (id: string) => ({ data: { user: authUser(id) }, error: null }),
  listUsers: async () => ({ data: { users: JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'email', email)), '[]') from auth.users`) || "[]") }, error: null }),
  updateUserById: async (id: string, a: { email?: string; password?: string; user_metadata?: Record<string, unknown> }) => {
    try {
      if (a.email && sql(`select count(*) from auth.users where lower(email) = lower(${lit(a.email)}) and id <> ${lit(id)}`) !== "0") {
        return { data: null, error: { message: "A user with this email address has already been registered" } };
      }
      const sets: string[] = [];
      if (a.email) sets.push(`email = ${lit(a.email)}`);
      if (a.password) sets.push(`encrypted_password = extensions.crypt(${lit(a.password)}, extensions.gen_salt('bf'))`);
      if (a.user_metadata) sets.push(`raw_user_meta_data = ${lit(a.user_metadata)}::jsonb`);
      if (sets.length) sql(`update auth.users set ${sets.join(", ")}, updated_at = now() where id = ${lit(id)}`);
      return { data: { user: authUser(id) }, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  },
};

function makeClient(asUser: boolean) {
  return {
    from: (t: string) => new Query(t),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      try {
        // uuid[] / text[] parametreleri (PostgREST JSON diziyi Postgres dizisine çevirir)
        const a = Object.entries(args)
          .map(([k, v]) => `${k} => ${ARRAY_ARGS.has(k) && Array.isArray(v) ? `${lit(`{${v.join(",")}}`)}` : lit(v)}`)
          .join(", ");
        // kullanıcı istemcisi: auth.uid() = oturumdaki kullanıcı (testte globalThis.__session)
        const uid = asUser ? ((globalThis as { __session?: { id: string } | null }).__session?.id ?? "") : "";
        const out = SETOF.has(name)
          ? sql(`select coalesce(json_agg(t), '[]') from public.${name}(${a}) t`, uid)
          : sql(`select to_jsonb(public.${name}(${a}))`, uid);
        return { data: out ? JSON.parse(out) : null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    auth: {
      admin: authAdmin,
      signOut: async () => ({ error: null }),
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const okPw = sql(`select (encrypted_password = extensions.crypt(${lit(password)}, encrypted_password))::text from auth.users where lower(email) = lower(${lit(email)})`);
        return okPw === "true" ? { data: { user: { email } }, error: null } : { data: { user: null }, error: { message: "Invalid login credentials" } };
      },
    },
  };
}
const adminClient = makeClient(false);
export function createAdminClient() { return adminClient; }
export async function createClient() { return makeClient(true); }
// @supabase/supabase-js createClient yerine (şifre doğrulama istemcisi)
export function createSupabaseJsClient() { return makeClient(false); }
