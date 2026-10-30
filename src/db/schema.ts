import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---- Roles & Permissions ----
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  readOnly: boolean("read_only").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  groupName: varchar("group_name", { length: 120 }).default("genel"),
});

export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull(),
  permissionCode: varchar("permission_code", { length: 120 }).notNull(),
});

// ---- Users ----
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: varchar("username", { length: 100 }).notNull().unique(),
    name: varchar("name", { length: 200 }).notNull(),
    email: varchar("email", { length: 200 }).notNull().unique(),
    phone: varchar("phone", { length: 30 }),
    passwordHash: text("password_hash").notNull(),
    roleId: integer("role_id"),
    quotaType: varchar("quota_type", { length: 20 }).default("variable").notNull(),
    quota: numeric("quota", { precision: 18, scale: 4 }).default("0").notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).default("1").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    twoFactor: boolean("two_factor").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("users_username_idx").on(t.username)]
);

// ---- Wallet ----
export const walletTransactions = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: varchar("type", { length: 20 }).notNull(), // topup|debit|refund|adjust
  credit: numeric("credit", { precision: 18, scale: 4 }).default("0").notNull(),
  unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).default("0").notNull(),
  totalPrice: numeric("total_price", { precision: 18, scale: 4 }).default("0").notNull(),
  currency: varchar("currency", { length: 10 }).default("TRY").notNull(),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 4 }).default("0").notNull(),
  refType: varchar("ref_type", { length: 50 }),
  refId: varchar("ref_id", { length: 100 }),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---- Orders & Messages ----
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  totalCount: integer("total_count").default(0).notNull(),
  processedCount: integer("processed_count").default(0).notNull(),
  message: text("message").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  createdBy: integer("created_by"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    userId: integer("user_id").notNull(),
    providerMessageId: varchar("provider_message_id", { length: 150 }),
    recipient: varchar("recipient", { length: 30 }).notNull(),
    body: text("body").notNull(),
    encoding: varchar("encoding", { length: 10 }).default("GSM").notNull(),
    segments: integer("segments").default(1).notNull(),
    cost: numeric("cost", { precision: 18, scale: 4 }).default("0").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    errorCode: varchar("error_code", { length: 50 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("sms_order_idx").on(t.orderId), index("sms_user_idx").on(t.userId)]
);

// ---- Contacts ----
export const contactLists = pgTable("contact_lists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  count: integer("count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    listId: integer("list_id").notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("contacts_list_idx").on(t.listId)]
);

export const blacklist = pgTable(
  "blacklist",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    phone: varchar("phone", { length: 30 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("blacklist_phone_idx").on(t.phone)]
);

// ---- Short URLs ----
export const shortUrls = pgTable("short_urls", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  businessName: varchar("business_name", { length: 150 }),
  originalUrl: text("original_url").notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  clicks: integer("clicks").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sentMessageHistory = pgTable("sent_message_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---- Support ----
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  status: varchar("status", { length: 20 }).default("open").notNull(),
  subject: varchar("subject", { length: 300 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  userId: integer("user_id").notNull(),
  message: text("message").notNull(),
  attachment: text("attachment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---- API Keys ----
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: varchar("name", { length: 150 }).default("Varsayılan"),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  keyHash: text("key_hash").notNull(),
  secretHash: text("secret_hash").notNull(),
  ipWhitelist: text("ip_whitelist"),
  callbackUrl: text("callback_url"),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---- Payments ----
export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  bankName: varchar("bank_name", { length: 150 }).notNull(),
  accountHolder: varchar("account_holder", { length: 200 }).notNull(),
  iban: varchar("iban", { length: 60 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
});

export const cryptoAssets = pgTable("crypto_assets", {
  id: serial("id").primaryKey(),
  asset: varchar("asset", { length: 20 }).notNull(),
  network: varchar("network", { length: 50 }).notNull(),
  walletAddress: text("wallet_address").notNull(),
  memoTag: varchar("memo_tag", { length: 100 }),
  explorerTxUrlTemplate: text("explorer_tx_url_template"),
  rateTry: numeric("rate_try", { precision: 24, scale: 8 }).default("0").notNull(),
  minAmountTry: numeric("min_amount_try", { precision: 18, scale: 2 }).default("0").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const topupRequests = pgTable(
  "topup_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    method: varchar("method", { length: 10 }).notNull(), // bank|crypto
    asset: varchar("asset", { length: 20 }),
    network: varchar("network", { length: 50 }),
    cryptoAssetId: integer("crypto_asset_id"),
    amountTry: numeric("amount_try", { precision: 18, scale: 2 }).notNull(),
    referenceCode: varchar("reference_code", { length: 30 }).notNull().unique(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    receiptPath: text("receipt_path"),
    senderName: varchar("sender_name", { length: 200 }),
    note: text("note"),
    walletAddressSnapshot: text("wallet_address_snapshot"),
    approvedBy: integer("approved_by"),
    approvedAt: timestamp("approved_at"),
    rejectReason: text("reject_reason"),
    creditedAmountTry: numeric("credited_amount_try", { precision: 18, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("topup_user_idx").on(t.userId)]
);

export const cryptoPaymentReports = pgTable("crypto_payment_reports", {
  id: serial("id").primaryKey(),
  topupRequestId: integer("topup_request_id").notNull().unique(),
  asset: varchar("asset", { length: 20 }).notNull(),
  network: varchar("network", { length: 50 }).notNull(),
  txid: text("txid").notNull().unique(),
  sentAmount: numeric("sent_amount", { precision: 24, scale: 8 }).notNull(),
  sentAt: timestamp("sent_at"),
  fromAddress: text("from_address"),
  receiptPath: text("receipt_path"),
  userNote: text("user_note"),
  rateTryApplied: numeric("rate_try_applied", { precision: 24, scale: 8 }),
  creditedAmountTry: numeric("credited_amount_try", { precision: 18, scale: 2 }),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const paymentSettings = pgTable("payment_settings", {
  id: serial("id").primaryKey(),
  minTopupTry: numeric("min_topup_try", { precision: 18, scale: 2 }).default("100"),
  maxTopupTry: numeric("max_topup_try", { precision: 18, scale: 2 }).default("500000"),
  requestTtlMinutes: integer("request_ttl_minutes").default(1440).notNull(),
  bankNote: text("bank_note"),
  maxOpenRequests: integer("max_open_requests").default(3).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const providerSettings = pgTable("provider_settings", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 80 }).notNull().unique(),
  credentialsEncrypted: text("credentials_encrypted"),
  isActive: boolean("is_active").default(false).notNull(),
  balance: numeric("balance", { precision: 18, scale: 2 }).default("0"),
  lowBalanceThreshold: numeric("low_balance_threshold", { precision: 18, scale: 2 }).default("1000"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id"),
  action: varchar("action", { length: 150 }).notNull(),
  ip: varchar("ip", { length: 60 }),
  payload: text("payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  direction: varchar("direction", { length: 20 }).notNull(),
  url: text("url"),
  payload: text("payload"),
  responseCode: integer("response_code"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 120 }).notNull().unique(),
  value: text("value").notNull(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    key: text("key").notNull(),
    response: text("response"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("idem_user_key").on(t.userId, t.key)]
);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  title: varchar("title", { length: 250 }).notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
