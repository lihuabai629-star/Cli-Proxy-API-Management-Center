import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { QuotaProgressBar } from '@/components/quota/QuotaCard';
import {
  IconCopy,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconSlidersHorizontal,
  IconTrash2,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { userManagementApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { formatDateTime, formatNumber } from '@/utils/format';
import type { ApiKeyManagementRow, ApiKeyQuotaTemporaryAdjustment } from '@/types/userManagement';
import styles from './UserManagementPage.module.scss';

interface UserRow extends ApiKeyManagementRow {
  displayName: string;
  keys: string[];
  primaryKey: string;
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'rename'; row: UserRow }
  | { mode: 'quota'; row: UserRow }
  | null;

const keyAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const clampPercent = (value: number | null): number | null => {
  if (value === null) return null;
  return Math.min(100, Math.max(0, value));
};

const calculateRemainingPercent = (remaining: unknown, limit: unknown): number | null => {
  const remainingNumber = toNumber(remaining);
  const limitNumber = toNumber(limit);
  if (remainingNumber === null || limitNumber === null || limitNumber <= 0) return null;
  return clampPercent((remainingNumber / limitNumber) * 100);
};

const calculateUsedPercent = (used: unknown, limit: unknown): number | null => {
  const usedNumber = toNumber(used);
  const limitNumber = toNumber(limit);
  if (usedNumber === null || limitNumber === null || limitNumber <= 0) return null;
  return clampPercent((usedNumber / limitNumber) * 100);
};

const formatPercent = (value: number | null): string => {
  if (value === null) return '--';
  if (value >= 99.95) return '100%';
  if (value <= 0.05) return '0%';
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
};

const formatCredits = (value: unknown): string => {
  const number = toNumber(value);
  if (number === null) return '--';
  if (Math.abs(number) >= 1000) {
    return number.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (Math.abs(number) >= 10) {
    return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatInteger = (value: unknown): string => {
  const number = toNumber(value);
  return number === null ? '--' : formatNumber(Math.round(number));
};

const formatDate = (value: unknown): string => {
  if (!value) return '--';
  const text = String(value);
  try {
    const formatted = formatDateTime(text);
    return formatted === 'Invalid Date' ? '--' : formatted;
  } catch {
    return '--';
  }
};

const formatSignedPercent = (value: unknown): string => {
  const number = toNumber(value);
  if (number === null || number <= 0) return '';
  const formatted = number >= 10 ? Math.round(number).toString() : number.toFixed(1).replace(/\.0$/, '');
  return `+${formatted}%`;
};

const maskApiKey = (key: string): string => {
  const trimmed = key.trim();
  if (!trimmed) return '--';
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`;
};

const generateApiKey = (): string => {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const body = Array.from(bytes, (byte) => keyAlphabet[byte % keyAlphabet.length]).join('');
  return `sk-cq-${body}`;
};

const quotaTargetForRow = (row: UserRow): { pool?: string; target_api_key?: string } => {
  const pool = String(row.pool || '').trim();
  if (pool) return { pool };
  if (row.primaryKey.startsWith('pool:')) return { pool: row.primaryKey.slice(5) };
  return { target_api_key: row.primaryKey };
};

const quotaAdjustmentSummary = (adjustment: ApiKeyQuotaTemporaryAdjustment): string => {
  const primary = formatSignedPercent(adjustment.primary_extra_percent);
  const weekly = formatSignedPercent(adjustment.weekly_extra_percent);
  const parts = [
    adjustment.name?.trim() || '临时加额',
    primary ? `5h ${primary}` : null,
    weekly ? `周 ${weekly}` : null,
    adjustment.expires_at ? `到 ${formatDate(adjustment.expires_at)}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
};

const activeQuotaAdjustments = (row: ApiKeyManagementRow): ApiKeyQuotaTemporaryAdjustment[] =>
  Array.isArray(row.temporary_adjustments)
    ? row.temporary_adjustments.filter((adjustment) => String(adjustment.id || '').trim())
    : [];

const temporaryQuotaSummary = (row: ApiKeyManagementRow): string => {
  const primary = formatSignedPercent(row.temporary_primary_extra_percent);
  const weekly = formatSignedPercent(row.temporary_weekly_extra_percent);
  if (!primary && !weekly) return '';
  return ['临时', primary ? `5h ${primary}` : null, weekly ? `周 ${weekly}` : null]
    .filter(Boolean)
    .join(' · ');
};

const resolveKeys = (row: ApiKeyManagementRow): string[] => {
  const keys = Array.isArray(row.api_keys) ? row.api_keys : [];
  const normalized = keys.map((key) => String(key || '').trim()).filter(Boolean);
  const primary = String(row.api_key || '').trim();
  if (primary && !normalized.includes(primary)) normalized.unshift(primary);
  return normalized;
};

function QuotaCell({
  label,
  limit,
  remaining,
  used,
  resetAt,
  unlimited,
}: {
  label: string;
  limit: unknown;
  remaining: unknown;
  used: unknown;
  resetAt: unknown;
  unlimited?: boolean | null;
}) {
  if (unlimited) {
    return <span className={styles.mainValue}>不限额</span>;
  }

  const remainingPercent = calculateRemainingPercent(remaining, limit);
  const usedPercent =
    remainingPercent === null ? calculateUsedPercent(used, limit) : clampPercent(100 - remainingPercent);
  const primaryText =
    remainingPercent === null
      ? `已用 ${formatPercent(usedPercent)}`
      : `剩余 ${formatPercent(remainingPercent)}`;
  const resetText = resetAt ? `重置 ${formatDate(resetAt)}` : '';

  return (
    <div
      className={styles.quotaStack}
      title={resetText ? `${label}: ${primaryText} · ${resetText}` : `${label}: ${primaryText}`}
    >
      <span className={styles.mainValue}>
        {label} {primaryText}
      </span>
      <QuotaProgressBar percent={remainingPercent} highThreshold={60} mediumThreshold={25} />
      {resetText && <span className={styles.subValue}>{resetText}</span>}
    </div>
  );
}

export function UserManagementPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();

  const [rows, setRows] = useState<UserRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [formName, setFormName] = useState('');
  const [formKey, setFormKey] = useState('');
  const [quotaName, setQuotaName] = useState('');
  const [quotaPrimaryPercent, setQuotaPrimaryPercent] = useState('10');
  const [quotaWeeklyPercent, setQuotaWeeklyPercent] = useState('10');
  const [quotaHours, setQuotaHours] = useState('24');

  const disabled = connectionStatus !== 'connected';

  const normalizeRows = useCallback((items: ApiKeyManagementRow[], names: Record<string, string>) => {
    return items
      .filter((row) => row.configured || row.unlimited)
      .map((row) => {
        const keys = resolveKeys(row);
        const primaryKey = keys[0] || String(row.api_key || '').trim();
        const nameFromMeta = keys.map((key) => names[key]).find((name) => name?.trim());
        const fallbackName = row.unlimited ? 'Admin' : row.name || '未命名用户';
        return {
          ...row,
          keys,
          primaryKey,
          displayName: String(nameFromMeta || fallbackName),
        };
      })
      .filter((row) => row.primaryKey);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [payload, namesPayload] = await Promise.all([
        userManagementApi.list(),
        userManagementApi.listNames().catch(() => ({ names: {} })),
      ]);
      setRows(normalizeRows(payload.api_keys || [], namesPayload.names || {}));
      setGeneratedAt(payload.generated_at || null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [normalizeRows, t]);

  useHeaderRefresh(loadUsers);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const totals = useMemo(() => {
    const latest = rows
      .map((row) => (row.last_used_at ? new Date(row.last_used_at).getTime() : 0))
      .filter((time) => Number.isFinite(time) && time > 0)
      .sort((a, b) => b - a)[0];
    return {
      users: rows.length,
      requests: rows.reduce((sum, row) => sum + (toNumber(row.used_requests) || 0), 0),
      tokens: rows.reduce((sum, row) => sum + (toNumber(row.total_tokens) || 0), 0),
      credits: rows.reduce((sum, row) => sum + (toNumber(row.codex_credits) || 0), 0),
      latest: latest ? new Date(latest).toISOString() : '',
    };
  }, [rows]);

  const openCreateDialog = () => {
    setDialog({ mode: 'create' });
    setFormName('');
    setFormKey(generateApiKey());
  };

  const openRenameDialog = (row: UserRow) => {
    setDialog({ mode: 'rename', row });
    setFormName(row.displayName);
    setFormKey(row.primaryKey);
  };

  const openQuotaDialog = (row: UserRow) => {
    setDialog({ mode: 'quota', row });
    setQuotaName(`${row.displayName} 临时加额`);
    setQuotaPrimaryPercent('10');
    setQuotaWeeklyPercent('10');
    setQuotaHours('24');
  };

  const closeDialog = () => {
    if (saving) return;
    setDialog(null);
  };

  const submitDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.mode === 'quota') {
      const name = quotaName.trim() || `${dialog.row.displayName} 临时加额`;
      const primaryPercent = quotaPrimaryPercent.trim() ? Number(quotaPrimaryPercent) : 0;
      const weeklyPercent = quotaWeeklyPercent.trim() ? Number(quotaWeeklyPercent) : 0;
      const hours = quotaHours.trim() ? Number(quotaHours) : 0;
      if (
        !Number.isFinite(primaryPercent) ||
        !Number.isFinite(weeklyPercent) ||
        primaryPercent < 0 ||
        weeklyPercent < 0 ||
        primaryPercent > 100 ||
        weeklyPercent > 100
      ) {
        showNotification('额度百分比必须在 0 到 100 之间', 'error');
        return;
      }
      if (primaryPercent <= 0 && weeklyPercent <= 0) {
        showNotification('至少填写一个 5h 或周额度加额百分比', 'error');
        return;
      }
      if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
        showNotification('有效期必须在 1 到 168 小时之间', 'error');
        return;
      }

      setSaving(true);
      try {
        await userManagementApi.createQuotaAdjustment({
          mode: 'quota_adjustment',
          name,
          ...quotaTargetForRow(dialog.row),
          primary_extra_percent: primaryPercent,
          weekly_extra_percent: weeklyPercent,
          hours,
        });
        showNotification('临时额度已生效', 'success');
        setDialog(null);
        await loadUsers();
      } catch (err: unknown) {
        showNotification(err instanceof Error ? err.message : '额度调整失败', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    const name = formName.trim();
    const apiKey = formKey.trim();
    if (!name) {
      showNotification('用户名不能为空', 'error');
      return;
    }
    if (!apiKey) {
      showNotification('API Key 不能为空', 'error');
      return;
    }

    setSaving(true);
    try {
      if (dialog?.mode === 'create') {
        const existingKeys = await userManagementApi.listKeys();
        if (existingKeys.includes(apiKey)) {
          throw new Error('API Key 已存在');
        }
        await userManagementApi.addKey(apiKey);
        await userManagementApi.saveName(apiKey, name);
        showNotification('用户已新增', 'success');
      } else if (dialog?.mode === 'rename') {
        await Promise.all(dialog.row.keys.map((key) => userManagementApi.saveName(key, name)));
        showNotification('用户名已更新', 'success');
      }
      setDialog(null);
      await loadUsers();
    } catch (err: unknown) {
      showNotification(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copyKeys = async (row: UserRow) => {
    const copied = await copyToClipboard(row.keys.join('\n'));
    showNotification(copied ? 'API Key 已复制' : '复制失败', copied ? 'success' : 'error');
  };

  const deleteQuotaAdjustment = (adjustment: ApiKeyQuotaTemporaryAdjustment) => {
    const adjustmentId = String(adjustment.id || '').trim();
    if (!adjustmentId) return;
    showConfirmation({
      title: '删除临时额度',
      message: `确认删除「${adjustment.name || '临时加额'}」？删除后该用户额度会立即恢复到基础配置。`,
      confirmText: '删除',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await userManagementApi.deleteQuotaAdjustment(adjustmentId);
          showNotification('临时额度已删除', 'success');
          await loadUsers();
        } catch (err: unknown) {
          showNotification(err instanceof Error ? err.message : '删除临时额度失败', 'error');
          throw err;
        }
      },
    });
  };

  const deleteRow = (row: UserRow) => {
    const keyCountLabel = row.keys.length > 1 ? `${row.keys.length} 个当前访问 Key` : '当前访问 Key';
    showConfirmation({
      title: '删除用户',
      message: `确认删除「${row.displayName}」？只删除${keyCountLabel}，历史用量数据会保留。`,
      confirmText: '删除',
      variant: 'danger',
      onConfirm: async () => {
        try {
          for (const key of row.keys) {
            await userManagementApi.deleteKey(key);
            await userManagementApi.deleteName(key).catch(() => undefined);
          }
          showNotification('用户已删除，历史用量已保留', 'success');
          await loadUsers();
        } catch (err: unknown) {
          showNotification(err instanceof Error ? err.message : '删除失败', 'error');
          throw err;
        }
      },
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>
            {t('user_management.title', { defaultValue: '用户管理' })}
          </h1>
          <p className={styles.description}>
            用户由显示名和客户端 API Key 组成；删除用户只移除活跃 Key，历史请求、tokens 和 credits 继续保留。
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" onClick={() => void loadUsers()} disabled={disabled || loading}>
            <IconRefreshCw size={16} />
            刷新
          </Button>
          <Button onClick={openCreateDialog} disabled={disabled}>
            <IconPlus size={16} />
            新增用户
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>活跃用户</span>
          <strong>{formatInteger(totals.users)}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>请求数</span>
          <strong>{formatInteger(totals.requests)}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Tokens</span>
          <strong>{formatInteger(totals.tokens)}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Credits</span>
          <strong>{formatCredits(totals.credits)}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>最近使用</span>
          <strong>{formatDate(totals.latest)}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>数据源</span>
          <strong>{generatedAt ? '已同步' : '--'}</strong>
        </article>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>用户名</th>
              <th>API Key</th>
              <th>状态</th>
              <th>5h 额度</th>
              <th>周额度</th>
              <th>Tokens / Credits</th>
              <th>请求数 / 最近使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className={styles.emptyCell}>
                  加载中...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.emptyCell}>
                  当前没有活跃用户。
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const status = row.unlimited ? '不限额' : row.exhausted ? '已用尽' : '可用';
                const statusClass = row.unlimited
                  ? styles.statusUnlimited
                  : row.exhausted
                    ? styles.statusBlocked
                    : styles.statusOk;
                const quotaAdjustments = activeQuotaAdjustments(row);
                const quotaSummary = temporaryQuotaSummary(row);
                return (
                  <tr key={`${row.primaryKey}-${row.bucket_id || row.displayName}`}>
                    <td>
                      <span className={styles.identity}>
                        <span className={styles.mainValue}>{row.displayName}</span>
                        <span className={styles.subValue}>客户端用户</span>
                      </span>
                    </td>
                    <td title={row.keys.join('\n')}>
                      <span className={styles.identity}>
                        <span className={styles.keyText}>{maskApiKey(row.primaryKey)}</span>
                        <span className={styles.subValue}>{row.role || 'user'}</span>
                      </span>
                    </td>
                    <td>
                      <span className={styles.identity}>
                        <span className={`${styles.statusPill} ${statusClass}`}>{status}</span>
                        {quotaSummary && <span className={styles.quotaBoost}>{quotaSummary}</span>}
                      </span>
                    </td>
                    <td>
                      <QuotaCell
                        label="5h"
                        limit={row.limit_credits}
                        remaining={row.remaining_credits}
                        used={row.used_credits}
                        resetAt={row.primary_reset_at || row.reset_at}
                        unlimited={row.unlimited}
                      />
                    </td>
                    <td>
                      <QuotaCell
                        label="周"
                        limit={row.weekly_limit_credits}
                        remaining={row.weekly_remaining_credits}
                        used={row.weekly_used_credits}
                        resetAt={row.weekly_reset_at}
                        unlimited={row.unlimited}
                      />
                    </td>
                    <td
                      title={`Input ${formatInteger(row.input_tokens)} / Output ${formatInteger(
                        row.output_tokens
                      )} / Reasoning ${formatInteger(row.reasoning_tokens)}`}
                    >
                      <span className={styles.identity}>
                        <span className={styles.mainValue}>{formatInteger(row.total_tokens)}</span>
                        <span className={styles.subValue}>{formatCredits(row.codex_credits)} credits</span>
                      </span>
                    </td>
                    <td>
                      <span className={styles.identity}>
                        <span className={styles.mainValue}>{formatInteger(row.used_requests)} 请求</span>
                        <span className={styles.subValue}>{formatDate(row.last_used_at)}</span>
                      </span>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => void copyKeys(row)}
                          title="复制 Key"
                          aria-label="复制 Key"
                        >
                          <IconCopy size={16} />
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => openRenameDialog(row)}
                          title="重命名用户"
                          aria-label="重命名用户"
                        >
                          <IconPencil size={16} />
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => openQuotaDialog(row)}
                          title="管理额度"
                          aria-label="管理额度"
                          disabled={Boolean(row.unlimited)}
                        >
                          <IconSlidersHorizontal size={16} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.dangerButton}`}
                          onClick={() => deleteRow(row)}
                          title="删除用户"
                          aria-label="删除用户"
                        >
                          <IconTrash2 size={16} />
                        </button>
                      </div>
                      {quotaAdjustments.length > 0 && (
                        <div className={styles.adjustmentList}>
                          {quotaAdjustments.map((adjustment) => (
                            <button
                              key={adjustment.id || quotaAdjustmentSummary(adjustment)}
                              type="button"
                              className={styles.adjustmentButton}
                              onClick={() => deleteQuotaAdjustment(adjustment)}
                              title="删除临时额度"
                            >
                              {quotaAdjustmentSummary(adjustment)}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={dialog !== null}
        onClose={closeDialog}
        title={
          dialog?.mode === 'quota'
            ? '管理额度'
            : dialog?.mode === 'rename'
              ? '重命名用户'
              : '新增用户'
        }
        closeDisabled={saving}
        width={560}
        footer={
          <>
            <Button variant="ghost" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => document.getElementById('user-management-form-submit')?.click()} loading={saving}>
              保存
            </Button>
          </>
        }
      >
        <form className={styles.form} onSubmit={(event) => void submitDialog(event)}>
          {dialog?.mode === 'quota' ? (
            <>
              <div className={styles.quotaTarget}>
                <span>目标用户</span>
                <strong>{dialog.row.displayName}</strong>
                <small>{dialog.row.pool ? `共享池 ${dialog.row.pool}` : maskApiKey(dialog.row.primaryKey)}</small>
              </div>
              <Input
                label="备注"
                value={quotaName}
                onChange={(event) => setQuotaName(event.target.value)}
                placeholder="例如：临时加额"
                autoFocus
              />
              <div className={styles.formGrid}>
                <Input
                  label="5h 加额百分比"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={quotaPrimaryPercent}
                  onChange={(event) => setQuotaPrimaryPercent(event.target.value)}
                  placeholder="0"
                />
                <Input
                  label="周加额百分比"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={quotaWeeklyPercent}
                  onChange={(event) => setQuotaWeeklyPercent(event.target.value)}
                  placeholder="0"
                />
                <Input
                  label="有效期（小时）"
                  type="number"
                  min="1"
                  max="168"
                  step="1"
                  value={quotaHours}
                  onChange={(event) => setQuotaHours(event.target.value)}
                  placeholder="24"
                />
              </div>
              {activeQuotaAdjustments(dialog.row).length > 0 && (
                <div className={styles.currentAdjustments}>
                  <span>当前临时额度</span>
                  {activeQuotaAdjustments(dialog.row).map((adjustment) => (
                    <button
                      key={adjustment.id || quotaAdjustmentSummary(adjustment)}
                      type="button"
                      className={styles.adjustmentButton}
                      onClick={() => deleteQuotaAdjustment(adjustment)}
                    >
                      {quotaAdjustmentSummary(adjustment)}
                    </button>
                  ))}
                </div>
              )}
              <p className={styles.formHint}>
                这里创建的是临时加额，不改变基础用户份额；到期或删除后会自动恢复。
              </p>
            </>
          ) : (
            <>
              <Input
                label="用户名"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                placeholder="输入显示名"
                required
                autoFocus
              />
              <Input
                label="API Key"
                value={formKey}
                onChange={(event) => setFormKey(event.target.value)}
                placeholder="自动生成或手动填写"
                required
                disabled={dialog?.mode === 'rename'}
                rightElement={
                  dialog?.mode === 'create' ? (
                    <button
                      type="button"
                      className={styles.generateButton}
                      onClick={() => setFormKey(generateApiKey())}
                    >
                      生成
                    </button>
                  ) : null
                }
              />
              <p className={styles.formHint}>
                {dialog?.mode === 'rename'
                  ? '重命名只更新管理展示名，不改变 API Key。'
                  : '新增用户会创建一个客户端 API Key，并保存这个显示名。'}
              </p>
            </>
          )}
          <button id="user-management-form-submit" type="submit" hidden />
        </form>
      </Modal>
    </div>
  );
}
