export const SYNC_CONFIG_KEY = 'itranslate-config'

export type StoredConfig = Record<string, string>

export function canSyncStorage() {
  return typeof chrome !== 'undefined' && !!chrome.storage?.sync
}

export async function readConfig(): Promise<StoredConfig> {
  if (!canSyncStorage()) return {}

  const result = await chrome.storage.sync.get([SYNC_CONFIG_KEY])
  return {...((result[SYNC_CONFIG_KEY] ?? {}) as StoredConfig)}
}
