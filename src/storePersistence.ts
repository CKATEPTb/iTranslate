import {canSyncStorage, SYNC_CONFIG_KEY, type StoredConfig} from './storageConfig.ts'

let pending: StoredConfig = {}
let timer: ReturnType<typeof setTimeout> | null = null

function canPersistFromContext() {
  return typeof document !== 'undefined'
}

function serializeConfigValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? ''
}

async function writePendingConfig(config: StoredConfig) {
  const current = ((await chrome.storage.sync.get([SYNC_CONFIG_KEY]))[SYNC_CONFIG_KEY] ?? {}) as StoredConfig
  await chrome.storage.sync.set({[SYNC_CONFIG_KEY]: {...current, ...config}})
}

export function shareConfigValue(key: string, value: unknown) {
  pending[key] = serializeConfigValue(value)

  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    if (!canPersistFromContext() || !canSyncStorage()) return

    const config = pending
    pending = {}
    await writePendingConfig(config)
  }, 200)
}
