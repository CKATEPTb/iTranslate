import type {DetectableLanguage} from '../languageDetection.ts'

export type PageTranslationSitePreference = {
  never?: boolean
  alwaysFrom?: Record<string, boolean>
}

export type PageTranslationPreferences = Record<string, PageTranslationSitePreference>

export type PageTranslationGlobalPreference = {
  alwaysFrom?: Record<string, boolean>
}

export type PageTranslationPreferenceSummary = {
  hostname: string
  never: boolean
  alwaysFrom: string[]
}

export type PageTranslationTabSession = {
  enabled: true
  sourceLanguage?: DetectableLanguage
  hostname?: string
  documentId?: string
  ignoreSitePreference?: boolean
}

type StoredPageTranslationTabSession = boolean | {
  enabled?: boolean
  sourceLanguage?: string
  hostname?: string
}

type NormalizeLanguage = (language: string) => DetectableLanguage | null

const PAGE_TRANSLATION_TABS_KEY = 'itranslate-page-translation-tabs'
const PAGE_TRANSLATION_PREFS_KEY = 'itranslate-page-translation-prefs'
const PAGE_TRANSLATION_GLOBAL_PREFS_KEY = 'itranslate-page-translation-global-prefs'

export function normalizeSiteHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, '')
}

export function getHostnameFromUrl(url: string | undefined): string {
  if (!url) return ''

  try {
    return normalizeSiteHostname(new URL(url).hostname)
  } catch {
    return ''
  }
}

function summarizePageTranslationPreference(
  hostname: string,
  preference: PageTranslationSitePreference,
  globalPreference: PageTranslationGlobalPreference
): PageTranslationPreferenceSummary {
  return {
    hostname,
    never: preference.never === true,
    alwaysFrom: Object.entries(globalPreference.alwaysFrom ?? {})
      .filter(([, enabled]) => enabled)
      .map(([language]) => language),
  }
}

export class PageTranslationSessionStore {
  private readonly activeTabs = new Map<number, PageTranslationTabSession>()
  private readonly normalizeLanguage: NormalizeLanguage

  constructor(normalizeLanguage: NormalizeLanguage) {
    this.normalizeLanguage = normalizeLanguage
  }

  get(tabId: number): PageTranslationTabSession | null {
    return this.activeTabs.get(tabId) ?? null
  }

  async set(tabId: number, session: PageTranslationTabSession, persist: boolean): Promise<void> {
    this.activeTabs.set(tabId, session)

    if (persist) {
      const tabs = await this.readStored()
      tabs[String(tabId)] = this.serialize(session)
      await this.writeStored(tabs)
      return
    }

    await this.clearStored(tabId)
  }

  async clear(tabId: number): Promise<void> {
    this.activeTabs.delete(tabId)
    await this.clearStored(tabId)
  }

  async clearLegacyStored(tabId: number): Promise<void> {
    await this.clearStored(tabId)
  }

  private normalizeStored(value: StoredPageTranslationTabSession | undefined): PageTranslationTabSession | null {
    if (value === true) return {enabled: true}
    if (!value || typeof value !== 'object' || value.enabled !== true) return null

    const sourceLanguage = typeof value.sourceLanguage === 'string'
      ? this.normalizeLanguage(value.sourceLanguage)
      : null
    const hostname = typeof value.hostname === 'string' ? normalizeSiteHostname(value.hostname) : ''
    return {
      enabled: true,
      ...(sourceLanguage ? {sourceLanguage} : {}),
      ...(hostname ? {hostname} : {}),
    }
  }

  private serialize(session: PageTranslationTabSession): StoredPageTranslationTabSession {
    return session.sourceLanguage || session.hostname
      ? {
        enabled: true,
        ...(session.sourceLanguage ? {sourceLanguage: session.sourceLanguage} : {}),
        ...(session.hostname ? {hostname: session.hostname} : {}),
      }
      : true
  }

  private async readStored(): Promise<Record<string, StoredPageTranslationTabSession>> {
    const stored = (await chrome.storage.local.get([PAGE_TRANSLATION_TABS_KEY]))[PAGE_TRANSLATION_TABS_KEY]
    return (stored as Record<string, StoredPageTranslationTabSession> | undefined) ?? {}
  }

  private async writeStored(tabs: Record<string, StoredPageTranslationTabSession>): Promise<void> {
    await chrome.storage.local.set({[PAGE_TRANSLATION_TABS_KEY]: tabs})
  }

  private async clearStored(tabId: number): Promise<void> {
    const tabs = await this.readStored()
    if (!this.normalizeStored(tabs[String(tabId)])) return

    delete tabs[String(tabId)]
    await this.writeStored(tabs)
  }
}

export class PageTranslationPreferenceStore {
  async getSite(hostname: string): Promise<PageTranslationSitePreference> {
    const prefs = await this.readSitePrefs()
    return prefs[normalizeSiteHostname(hostname)] ?? {}
  }

  async getSiteForTab(tab: chrome.tabs.Tab): Promise<PageTranslationSitePreference> {
    const hostname = getHostnameFromUrl(tab.url)
    return hostname ? this.getSite(hostname) : {}
  }

  async getGlobal(): Promise<PageTranslationGlobalPreference> {
    const preference: PageTranslationGlobalPreference = {...(await this.readStoredGlobal())}
    const prefs = await this.readSitePrefs()
    let migrated = false

    for (const [hostname, sitePreference] of Object.entries(prefs)) {
      const legacyAlwaysFrom = sitePreference.alwaysFrom ?? {}
      for (const [language, enabled] of Object.entries(legacyAlwaysFrom)) {
        if (enabled) {
          preference.alwaysFrom = {...(preference.alwaysFrom ?? {}), [language]: true}
          migrated = true
        }
      }

      if (sitePreference.alwaysFrom) {
        delete sitePreference.alwaysFrom
        migrated = true
        if (!sitePreference.never) {
          delete prefs[hostname]
        }
      }
    }

    if (migrated) {
      await this.writeSitePrefs(prefs)
      await this.writeGlobal(preference)
    }

    return preference
  }

  async summarize(hostname: string): Promise<PageTranslationPreferenceSummary> {
    const normalizedHostname = normalizeSiteHostname(hostname)
    return summarizePageTranslationPreference(
      normalizedHostname,
      normalizedHostname ? await this.getSite(normalizedHostname) : {},
      await this.getGlobal(),
    )
  }

  async setNever(hostname: string): Promise<PageTranslationPreferenceSummary> {
    const normalizedHostname = normalizeSiteHostname(hostname)
    if (!normalizedHostname) return this.summarize('')

    const prefs = await this.readSitePrefs()
    prefs[normalizedHostname] = {...(prefs[normalizedHostname] ?? {}), never: true}
    await this.writeSitePrefs(prefs)
    return this.summarize(normalizedHostname)
  }

  async clearNever(hostname: string): Promise<PageTranslationPreferenceSummary> {
    const normalizedHostname = normalizeSiteHostname(hostname)
    if (!normalizedHostname) return this.summarize('')

    const prefs = await this.readSitePrefs()
    const preference: PageTranslationSitePreference = {...(prefs[normalizedHostname] ?? {})}
    delete preference.never

    if (Object.keys(preference).length > 0) {
      prefs[normalizedHostname] = preference
    } else {
      delete prefs[normalizedHostname]
    }

    await this.writeSitePrefs(prefs)
    return this.summarize(normalizedHostname)
  }

  async setAlwaysFrom(language: string): Promise<void> {
    const normalizedLanguage = language.trim().toLowerCase()
    const preference = await this.getGlobal()
    preference.alwaysFrom = {...(preference.alwaysFrom ?? {}), [normalizedLanguage]: true}
    await this.writeGlobal(preference)
  }

  async clearAlwaysFrom(language: string): Promise<void> {
    const normalizedLanguage = language.trim().toLowerCase()
    const preference = await this.getGlobal()

    if (preference.alwaysFrom) {
      delete preference.alwaysFrom[normalizedLanguage]
      if (Object.keys(preference.alwaysFrom).length === 0) {
        delete preference.alwaysFrom
      }
    }

    await this.writeGlobal(preference)
  }

  private async readSitePrefs(): Promise<PageTranslationPreferences> {
    const stored = (await chrome.storage.sync.get([PAGE_TRANSLATION_PREFS_KEY]))[PAGE_TRANSLATION_PREFS_KEY]
    return (stored as PageTranslationPreferences | undefined) ?? {}
  }

  private async writeSitePrefs(prefs: PageTranslationPreferences): Promise<void> {
    await chrome.storage.sync.set({[PAGE_TRANSLATION_PREFS_KEY]: prefs})
  }

  private async readStoredGlobal(): Promise<PageTranslationGlobalPreference> {
    const stored = (await chrome.storage.sync.get([PAGE_TRANSLATION_GLOBAL_PREFS_KEY]))[PAGE_TRANSLATION_GLOBAL_PREFS_KEY]
    return (stored as PageTranslationGlobalPreference | undefined) ?? {}
  }

  private async writeGlobal(preference: PageTranslationGlobalPreference): Promise<void> {
    if (Object.keys(preference).length === 0) {
      await chrome.storage.sync.remove(PAGE_TRANSLATION_GLOBAL_PREFS_KEY)
      return
    }

    await chrome.storage.sync.set({[PAGE_TRANSLATION_GLOBAL_PREFS_KEY]: preference})
  }
}
