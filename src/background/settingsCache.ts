import {readConfig, SYNC_CONFIG_KEY} from '../storageConfig.ts'

export type ExtensionSettings = Awaited<ReturnType<typeof readConfig>>

let settingsCache: ExtensionSettings | null = null
let settingsCachePromise: Promise<ExtensionSettings> | null = null
let settingsInvalidationBound = false

function invalidateSettingsCache() {
  settingsCache = null
  settingsCachePromise = null
}

export function bindSettingsCacheInvalidation() {
  if (settingsInvalidationBound) return
  settingsInvalidationBound = true

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SYNC_CONFIG_KEY]) {
      invalidateSettingsCache()
    }
  })
}

export async function readSettings(): Promise<ExtensionSettings> {
  if (settingsCache) return settingsCache

  settingsCachePromise ??= readConfig()
    .then((settings) => {
      settingsCache = settings
      return settings
    })
    .finally(() => {
      settingsCachePromise = null
    })

  return settingsCachePromise
}
