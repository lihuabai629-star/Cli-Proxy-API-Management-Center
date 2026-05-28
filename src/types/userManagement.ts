export interface ApiKeyQuotaTemporaryAdjustment {
  id?: string | null;
  name?: string | null;
  api_key?: string | null;
  pool?: string | null;
  family?: string | null;
  primary_extra_percent?: number | null;
  weekly_extra_percent?: number | null;
  created_at?: string | null;
  expires_at?: string | null;
}

export interface ApiKeyManagementRow {
  name?: string | null;
  api_key?: string | null;
  api_keys?: string[] | null;
  api_key_count?: number | null;
  role?: string | null;
  pool?: string | null;
  share?: number | null;
  configured?: boolean | null;
  unlimited?: boolean | null;
  pinned_auth_id?: string | null;
  bucket_id?: string | null;
  limit_credits?: number | null;
  used_credits?: number | null;
  remaining_credits?: number | null;
  reset_at?: string | null;
  primary_reset_at?: string | null;
  primary_used_percent?: number | null;
  official_weekly_used_percent?: number | null;
  weekly_share?: number | null;
  weekly_share_label?: string | null;
  weekly_limit_credits?: number | null;
  weekly_used_credits?: number | null;
  weekly_remaining_credits?: number | null;
  weekly_reset_at?: string | null;
  weekly_used_percent?: number | null;
  exhausted?: boolean | null;
  weekly_exhausted?: boolean | null;
  temporary_primary_extra_percent?: number | null;
  temporary_weekly_extra_percent?: number | null;
  temporary_adjustments?: ApiKeyQuotaTemporaryAdjustment[] | null;
  temporary?: boolean | null;
  expires_at?: string | null;
  used_requests?: number | null;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
  reasoning_tokens?: number | null;
  total_tokens?: number | null;
  codex_credits?: number | null;
  last_used_at?: string | null;
}

export interface ApiKeyManagementPayload {
  generated_at?: string | null;
  api_keys?: ApiKeyManagementRow[];
}

export interface ApiKeyNamesPayload {
  names?: Record<string, string>;
}

export interface ApiKeysPayload {
  'api-keys'?: string[];
  apiKeys?: string[];
}

export interface CreateQuotaAdjustmentPayload {
  mode: 'quota_adjustment';
  name: string;
  target_api_key?: string;
  pool?: string;
  primary_extra_percent?: number;
  weekly_extra_percent?: number;
  hours: number;
}

export interface TemporaryQuotaResponse {
  mode?: string;
  id?: string;
  name?: string;
  api_key?: string;
  pool?: string;
  primary_extra_percent?: number;
  weekly_extra_percent?: number;
  hours?: number;
  expires_at?: string;
  temporary?: boolean;
}
