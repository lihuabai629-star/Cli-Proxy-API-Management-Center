import { apiClient } from './client';
import type {
  ApiKeyManagementPayload,
  ApiKeyNamesPayload,
  ApiKeysPayload,
  CreateQuotaAdjustmentPayload,
  TemporaryQuotaResponse,
} from '@/types/userManagement';

const namesEndpoint = '/api-key-names';

const readKeys = (payload: ApiKeysPayload): string[] => {
  const keys = payload['api-keys'] ?? payload.apiKeys;
  return Array.isArray(keys) ? keys.map((key) => String(key).trim()).filter(Boolean) : [];
};

export const userManagementApi = {
  list: () => apiClient.get<ApiKeyManagementPayload>('/api-key-management'),

  async listKeys(): Promise<string[]> {
    return readKeys(await apiClient.get<ApiKeysPayload>('/api-keys'));
  },

  addKey: (apiKey: string) => apiClient.patch('/api-keys', { old: '', new: apiKey }),

  async deleteKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    try {
      await apiClient.delete(`/api-keys?value=${encodeURIComponent(trimmed)}`);
      return;
    } catch {
      const keys = await userManagementApi.listKeys();
      const index = keys.indexOf(trimmed);
      if (index < 0) {
        throw new Error('刷新后没有找到这个 API Key');
      }
      await apiClient.delete(`/api-keys?index=${index}`);
    }
  },

  listNames: () => apiClient.get<ApiKeyNamesPayload>(namesEndpoint),

  saveName: (apiKey: string, name: string) =>
    apiClient.patch(namesEndpoint, { api_key: apiKey, name }),

  deleteName: (apiKey: string) =>
    apiClient.delete(`${namesEndpoint}?api_key=${encodeURIComponent(apiKey)}`),

  createQuotaAdjustment: (payload: CreateQuotaAdjustmentPayload) =>
    apiClient.post<TemporaryQuotaResponse>('/api-key-management/temporary', payload),

  deleteQuotaAdjustment: (adjustmentId: string) =>
    apiClient.delete(`/api-key-management/temporary?adjustment_id=${encodeURIComponent(adjustmentId)}`),
};
