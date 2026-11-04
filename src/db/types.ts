// WOLTSMS - Supabase veritabanı tipleri (migration'lardan türetilmiştir)
// production'da `supabase gen types typescript --linked` ile yenileyin.

export type Json = string | number | boolean | null | { [k: string]: Json | undefined } | Json[];

export type QuotaType = "variable" | "fixed";
export type OrderStatus = "pending" | "scheduled" | "processing" | "completed" | "failed" | "cancelled";
export type MessageStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "refunded";
export type TxType = "topup" | "debit" | "refund" | "adjust" | "reserve" | "release";
export type TopupMethod = "bank" | "crypto";
export type TopupStatus = "pending" | "reported" | "approved" | "rejected" | "expired";
export type JobType = "send_batch" | "import_file" | "callback" | "dlr_poll" | "export_file" | "file_scan";

export interface Profile {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  role_id: string | null;
  quota_type: QuotaType;
  is_active: boolean;
  two_factor_enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  name: string;
  read_only: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  group_name: string;
}

export interface RolePermission {
  id: string;
  role_id: string;
  permission_code: string;
}

export interface Wallet {
  user_id: string;
  balance: string;
  reserved: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  type: TxType;
  credit: string;
  unit_price: string | null;
  total_price: string | null;
  currency: string;
  balance_after: string;
  ref_type: string | null;
  ref_id: string | null;
  description: string | null;
  created_at: string;
}

export interface Pricing {
  id: string;
  user_id: string | null;
  unit_price: string;
}

export interface Order {
  id: string;
  user_id: string;
  status: OrderStatus;
  total_count: number;
  processed_count: number;
  failed_count: number;
  total_cost: string;
  message: string | null;
  note: string | null;
  scheduled_at: string | null;
  source: "panel" | "api";
  created_by: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsMessage {
  id: string;
  order_id: string;
  user_id: string;
  provider_message_id: string | null;
  recipient: string;
  body: string;
  encoding: "GSM" | "UCS2";
  segments: number;
  cost: string;
  status: MessageStatus;
  attempts: number;
  error_code: string | null;
  next_attempt_at: string | null;
  refunded_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactList {
  id: string;
  user_id: string;
  title: string;
  count: number;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  list_id: string;
  phone: string;
  created_at: string;
}

export interface BlacklistEntry {
  id: string;
  user_id: string | null;
  phone: string;
  created_at: string;
}

export interface ShortUrl {
  id: string;
  user_id: string;
  business_name: string;
  original_url: string;
  slug: string;
  clicks: number;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  status: "open" | "answered" | "closed";
  subject: string;
  created_at: string;
  updated_at: string;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  user_id: string | null;
  is_admin: boolean;
  body: string;
  attachment_path: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  ip_whitelist: string[];
  callback_url: string | null;
  status: "active" | "disabled";
  hmac_secret_encrypted: string | null;
  key_encrypted?: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface BankAccount {
  id: string;
  bank_name: string;
  account_holder: string;
  iban: string;
  branch: string | null;
  currency: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CryptoAsset {
  id: string;
  asset: string;
  network: string;
  wallet_address: string;
  memo_tag: string | null;
  explorer_tx_url_template: string;
  rate_try: string;
  rate_updated_at: string;
  min_amount_try: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentSettings {
  id: string;
  min_topup_try: string;
  max_topup_try: string;
  request_ttl_minutes: number;
  max_open_requests: number;
  bank_note: string;
}

export interface TopupRequest {
  id: string;
  user_id: string;
  method: TopupMethod;
  amount_try: string;
  reference_code: string;
  status: TopupStatus;
  receipt_path: string | null;
  sender_name: string | null;
  note: string | null;
  wallet_address_snapshot: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approved_amount_try: string | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CryptoPaymentReport {
  id: string;
  topup_request_id: string;
  asset: string;
  network: string;
  txid: string;
  sent_amount: string;
  sent_at: string | null;
  from_address: string | null;
  receipt_path: string | null;
  user_note: string | null;
  rate_try_applied: string | null;
  credited_amount_try: string | null;
  admin_note: string | null;
  created_at: string;
}

export interface ProviderSettings {
  id: string;
  provider: string;
  base_url: string;
  sender_id: string;
  credentials_encrypted: string | null;
  is_active: boolean;
  low_balance_threshold: string;
  balance: string | null;
  balance_currency: string | null;
  last_balance_at: string | null;
  last_error: string | null;
  config: Json;
}

export interface Announcement {
  id: string;
  text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string | null;
  type: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  ip: string | null;
  payload: Json;
  created_at: string;
}

export interface Job {
  id: string;
  type: JobType;
  payload: Json;
  status: "pending" | "running" | "done" | "failed";
  run_at: string;
  attempts: number;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface ImportJob {
  id: string;
  user_id: string;
  kind: "contact_list" | "blacklist";
  list_id: string | null;
  storage_path: string;
  filename: string;
  status: "pending" | "processing" | "done" | "failed";
  total: number;
  imported: number;
  duplicates: number;
  blacklisted: number;
  invalid: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      roles: { Row: Role; Insert: Partial<Role>; Update: Partial<Role> };
      permissions: { Row: Permission; Insert: Partial<Permission>; Update: Partial<Permission> };
      role_permissions: { Row: RolePermission; Insert: Partial<RolePermission>; Update: Partial<RolePermission> };
      wallets: { Row: Wallet; Insert: Partial<Wallet>; Update: Partial<Wallet> };
      wallet_transactions: { Row: WalletTransaction; Insert: Partial<WalletTransaction>; Update: Partial<WalletTransaction> };
      pricing: { Row: Pricing; Insert: Partial<Pricing>; Update: Partial<Pricing> };
      orders: { Row: Order; Insert: Partial<Order>; Update: Partial<Order> };
      sms_messages: { Row: SmsMessage; Insert: Partial<SmsMessage>; Update: Partial<SmsMessage> };
      contact_lists: { Row: ContactList; Insert: Partial<ContactList>; Update: Partial<ContactList> };
      contacts: { Row: Contact; Insert: Partial<Contact>; Update: Partial<Contact> };
      blacklist: { Row: BlacklistEntry; Insert: Partial<BlacklistEntry>; Update: Partial<BlacklistEntry> };
      short_urls: { Row: ShortUrl; Insert: Partial<ShortUrl>; Update: Partial<ShortUrl> };
      support_tickets: { Row: SupportTicket; Insert: Partial<SupportTicket>; Update: Partial<SupportTicket> };
      ticket_messages: { Row: TicketMessage; Insert: Partial<TicketMessage>; Update: Partial<TicketMessage> };
      api_keys: { Row: ApiKey; Insert: Partial<ApiKey>; Update: Partial<ApiKey> };
      bank_accounts: { Row: BankAccount; Insert: Partial<BankAccount>; Update: Partial<BankAccount> };
      crypto_assets: { Row: CryptoAsset; Insert: Partial<CryptoAsset>; Update: Partial<CryptoAsset> };
      payment_settings: { Row: PaymentSettings; Insert: Partial<PaymentSettings>; Update: Partial<PaymentSettings> };
      topup_requests: { Row: TopupRequest; Insert: Partial<TopupRequest>; Update: Partial<TopupRequest> };
      crypto_payment_reports: { Row: CryptoPaymentReport; Insert: Partial<CryptoPaymentReport>; Update: Partial<CryptoPaymentReport> };
      provider_settings: { Row: ProviderSettings; Insert: Partial<ProviderSettings>; Update: Partial<ProviderSettings> };
      announcements: { Row: Announcement; Insert: Partial<Announcement>; Update: Partial<Announcement> };
      notifications: { Row: Notification; Insert: Partial<Notification>; Update: Partial<Notification> };
      audit_logs: { Row: AuditLog; Insert: Partial<AuditLog>; Update: Partial<AuditLog> };
      jobs: { Row: Job; Insert: Partial<Job>; Update: Partial<Job> };
      import_jobs: { Row: ImportJob; Insert: Partial<ImportJob>; Update: Partial<ImportJob> };
    };
    Functions: {
      rpc_create_order: {
        Args: {
          p_recipients: Json;
          p_message: string;
          p_schedule_at?: string | null;
          p_source?: string;
          p_idempotency_key?: string | null;
          p_contact_list_id?: string | null;
          p_user_id?: string | null;
        };
        Returns: Json;
      };
      rpc_cancel_order: { Args: { p_order_id: string }; Returns: Json };
      user_has_permission: { Args: { p_user_id: string; p_code: string }; Returns: boolean };
      rpc_claim_send_batch: { Args: { p_limit?: number }; Returns: SmsMessage[] };
      rpc_complete_send: {
        Args: { p_message_id: string; p_ok: boolean; p_provider_message_id?: string | null; p_error?: string | null };
        Returns: Json;
      };
      rpc_cancel_out_of_window: { Args: Record<string, never>; Returns: number };
      rpc_expire_topups: { Args: Record<string, never>; Returns: number };
      rpc_finalize_message: { Args: { p_message_id: string; p_provider_message_id?: string | null }; Returns: Json };
      rpc_refund_message: { Args: { p_message_id: string; p_reason?: string | null }; Returns: Json };
      rpc_apply_dlr: {
        Args: { p_provider_message_id: string; p_state: string; p_error?: string | null; p_time?: string | null };
        Returns: Json;
      };
      rpc_approve_topup: { Args: { p_topup_id: string; p_credit_amount: number; p_admin_note?: string | null }; Returns: Json };
      rpc_admin_adjust: { Args: { p_user_id: string; p_amount: number; p_description?: string | null }; Returns: Json };
      rpc_get_balance: { Args: { p_user_id?: string | null }; Returns: { balance: number; reserved: number; unit_price: number }[] };
      rpc_create_topup: {
        Args: {
          p_method: string;
          p_amount_try: number;
          p_receipt_path?: string | null;
          p_sender_name?: string | null;
          p_note?: string | null;
          p_asset_id?: string | null;
        };
        Returns: Json;
      };
      rpc_report_topup: {
        Args: {
          p_topup_id: string;
          p_txid: string;
          p_sent_amount: number;
          p_sent_at?: string | null;
          p_from_address?: string | null;
          p_user_note?: string | null;
          p_receipt_path?: string | null;
        };
        Returns: Json;
      };
      rpc_report_bank_topup: {
        Args: { p_topup_id: string; p_sender_name?: string | null; p_note?: string | null; p_receipt_path?: string | null };
        Returns: Json;
      };
      rpc_reject_topup: { Args: { p_topup_id: string; p_reason: string }; Returns: Json };
      rpc_upsert_blacklist: { Args: { p_phones: string[]; p_remove?: boolean }; Returns: Json };
      rpc_create_contact_list: { Args: { p_title: string; p_numbers: string[] }; Returns: Json };
      rpc_save_api_key: { Args: { p_key_id: string; p_name: string; p_ip_whitelist: Json; p_callback_url: string | null }; Returns: Json };
      rpc_delete_api_key: { Args: { p_key_id: string }; Returns: Json };
      rpc_create_short_url: { Args: { p_original_url: string; p_business_name: string; p_slug: string }; Returns: Json };
      rpc_delete_short_url: { Args: { p_id: string }; Returns: Json };
      rpc_create_ticket: { Args: { p_subject: string; p_body: string }; Returns: Json };
      rpc_reply_ticket: { Args: { p_ticket_id: string; p_body: string; p_is_admin?: boolean }; Returns: Json };
      rpc_set_ticket_status: { Args: { p_ticket_id: string; p_status: string }; Returns: Json };
      rpc_create_user: {
        Args: {
          p_email: string;
          p_password: string;
          p_username: string;
          p_name: string;
          p_phone: string | null;
          p_role_id: string | null;
          p_quota_type: string;
          p_unit_price: number | null;
        };
        Returns: Json;
      };
      admin_update_user: {
        Args: {
          p_user_id: string;
          p_name?: string | null;
          p_phone?: string | null;
          p_role_id?: string | null;
          p_quota_type?: string | null;
          p_email?: string | null;
          p_unit_price?: number | null;
        };
        Returns: Json;
      };
      admin_delete_user: { Args: { p_user_id: string }; Returns: Json };
      admin_set_user_active: { Args: { p_user_id: string; p_active: boolean }; Returns: Json };
      admin_create_role: { Args: { p_name: string; p_read_only: boolean }; Returns: Json };
      admin_update_role: { Args: { p_role_id: string; p_name: string; p_read_only: boolean }; Returns: Json };
      admin_set_role_permissions: { Args: { p_role_id: string; p_codes: string[] }; Returns: Json };
      resolve_username_email: { Args: { p_username: string }; Returns: string };
      has_permission: { Args: { p_code: string }; Returns: boolean };
      has_any_permission: { Args: { p_codes: string[] }; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      sms_segments: { Args: { p_msg: string }; Returns: number };
      sms_detect_encoding: { Args: { p_msg: string }; Returns: string };
      normalize_phone: { Args: { p_phone: string }; Returns: string };
      normalize_recipients: { Args: { p_text: string }; Returns: string[] };
      short_url_click: { Args: { p_slug: string }; Returns: { original_url: string }[] };
      rate_limit_check: { Args: { p_key: string; p_max: number; p_window_seconds: number }; Returns: boolean };
    };
  };
}
