import {readConfig, SYNC_CONFIG_KEY} from '../storageConfig.ts'
import {getTranslator} from './translator'
import type {TranslateContext, Translator} from './translator/types.ts'
import {splitTranslationText} from './translationChunks.ts'
import {normalizeProvider, supportsPageTranslation} from '../providers.ts'
import {detectTextLanguage, isTextLikelyLanguage, type DetectableLanguage} from '../languageDetection.ts'

type TranslateMode = 'selection' | 'input' | 'page'

type TranslateRequestMessage = {
  type: 'TRANSLATE_TEXT'
  text: string
  mode: TranslateMode
  fromOverride?: string
}

type TranslatePrecheckMessage = {
  type: 'TRANSLATE_TEXT_PRECHECK'
  text: string
  mode: TranslateMode
}

type SidePanelTranslateMessage = {
  type: 'SIDEPANEL_TRANSLATE'
  text: string
  provider: string
  from: string
  to: string
}

type PageTranslationGetActiveMessage = {
  type: 'PAGE_TRANSLATION_GET_ACTIVE'
}

type PageTranslationSetActiveMessage = {
  type: 'PAGE_TRANSLATION_SET_ACTIVE'
  enabled: boolean
  sourceLanguage?: string
}

type PageTranslationGetStateMessage = {
  type: 'PAGE_TRANSLATION_GET_STATE'
}

type PageTranslationSuggestSettingsMessage = {
  type: 'PAGE_TRANSLATION_SUGGEST_SETTINGS'
  hostname: string
}

type PageTranslationSetSitePreferenceMessage = {
  type: 'PAGE_TRANSLATION_SET_SITE_PREFERENCE'
  hostname: string
  action: 'never' | 'always-from'
  language?: string
}

type PageTranslationClearSitePreferenceMessage = {
  type: 'PAGE_TRANSLATION_CLEAR_SITE_PREFERENCE'
  hostname: string
  action: 'never' | 'always-from'
  language?: string
}

type PageTranslationAnalyzeSamplesMessage = {
  type: 'PAGE_TRANSLATION_ANALYZE_SAMPLES'
  target: string
  samples: string[]
  documentLanguage?: string
}

type RuntimeMessage =
  | TranslateRequestMessage
  | TranslatePrecheckMessage
  | SidePanelTranslateMessage
  | PageTranslationGetActiveMessage
  | PageTranslationSetActiveMessage
  | PageTranslationGetStateMessage
  | PageTranslationSuggestSettingsMessage
  | PageTranslationSetSitePreferenceMessage
  | PageTranslationClearSitePreferenceMessage
  | PageTranslationAnalyzeSamplesMessage

type PageTranslationSitePreference = {
  never?: boolean
  alwaysFrom?: Record<string, boolean>
}

type PageTranslationPreferences = Record<string, PageTranslationSitePreference>

type PageTranslationGlobalPreference = {
  alwaysFrom?: Record<string, boolean>
}

type PageTranslationTabSession = {
  enabled: true
  sourceLanguage?: DetectableLanguage
  hostname?: string
}

type StoredPageTranslationTabSession = boolean | {
  enabled?: boolean
  sourceLanguage?: string
  hostname?: string
}

type TranslateTextResult = {
  translatedText: string
  skipped?: boolean
}

type TranslatePrecheckResult = {
  skipped: boolean
}

type SendResponse = (response?: unknown) => void

const PAGE_TRANSLATION_TABS_KEY = 'itranslate-page-translation-tabs'
const PAGE_TRANSLATION_PREFS_KEY = 'itranslate-page-translation-prefs'
const PAGE_TRANSLATION_GLOBAL_PREFS_KEY = 'itranslate-page-translation-global-prefs'
const PAGE_TRANSLATION_ANALYSIS_MIN_WEIGHT = 160
const PROVIDERS_WITH_NATIVE_AUTO_SOURCE = new Set(['Google', 'DeepL', 'LibreTranslate', 'Lara', 'OpenAI (Ollama)'])
const pageTranslationTabs = new Map<number, PageTranslationTabSession>()
const translatorCache = new Map<string, Translator>()

type ExtensionSettings = Awaited<ReturnType<typeof readConfig>>

let settingsCache: ExtensionSettings | null = null
let settingsCachePromise: Promise<ExtensionSettings> | null = null

function invalidateSettingsCache() {
  settingsCache = null
  settingsCachePromise = null
}

async function readSettings(): Promise<ExtensionSettings> {
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SYNC_CONFIG_KEY]) {
    invalidateSettingsCache()
  }
})
const LANGUAGE_ALIASES: Record<string, DetectableLanguage> = {
  eng: 'en',
  en: 'en',
  english: 'en',
  rus: 'ru',
  ru: 'ru',
  russian: 'ru',
  ukr: 'ua',
  uk: 'ua',
  ua: 'ua',
  ukrainian: 'ua',
  deu: 'de',
  ger: 'de',
  de: 'de',
  german: 'de',
  fra: 'fr',
  fre: 'fr',
  fr: 'fr',
  french: 'fr',
}

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise(resolve => {
    try {
      chrome.tabs.query({active: true, currentWindow: true}, tabs => {
        void chrome.runtime.lastError
        resolve(tabs[0])
      })
    } catch {
      resolve(undefined)
    }
  })
}

function canTranslateTab(tab: chrome.tabs.Tab): boolean {
  const url = tab.url ?? ''
  return /^(https?:|file:)/i.test(url)
}

function normalizeSiteHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, '')
}

function normalizeDetectableLanguage(language: string): DetectableLanguage | null {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return null

  for (const part of normalized.split(/[,;]/)) {
    const token = part.trim()
    if (!token) continue

    const primary = token.split(/[-_\s]/)[0]
    const parsed = LANGUAGE_ALIASES[token] ?? LANGUAGE_ALIASES[primary]
    if (parsed) return parsed
  }

  return null
}

function getLanguageSampleWeight(text: string): number {
  const letterPattern = /\p{L}/gu
  let letters = 0
  while (letters < 700 && letterPattern.exec(text)) {
    letters++
  }
  return letters
}

function getCachedTranslator(provider: string): Translator {
  let translator = translatorCache.get(provider)
  if (!translator) {
    translator = getTranslator(provider)
    translatorCache.set(provider, translator)
  }
  return translator
}

async function translateWithProvider(provider: string, context: TranslateContext): Promise<string> {
  const chunks = splitTranslationText(context.text)
  const translator = getCachedTranslator(provider)
  if (chunks.length === 1) return translator.translate(context)

  const translatedChunks: string[] = []
  for (const chunk of chunks) {
    translatedChunks.push(chunk.trim() ? await translator.translate({...context, text: chunk}) : chunk)
  }

  return translatedChunks.join('')
}

function getHostnameFromUrl(url: string | undefined): string {
  if (!url) return ''

  try {
    return normalizeSiteHostname(new URL(url).hostname)
  } catch {
    return ''
  }
}

function sendTabMessage(tabId: number, message: unknown): Promise<boolean> {
  return new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        const error = chrome.runtime.lastError
        resolve(!error)
      })
    } catch {
      resolve(false)
    }
  })
}

function normalizePageTranslationTabSession(value: StoredPageTranslationTabSession | undefined): PageTranslationTabSession | null {
  if (value === true) return {enabled: true}
  if (!value || typeof value !== 'object' || value.enabled !== true) return null

  const sourceLanguage = typeof value.sourceLanguage === 'string'
    ? normalizeDetectableLanguage(value.sourceLanguage)
    : null
  const hostname = typeof value.hostname === 'string' ? normalizeSiteHostname(value.hostname) : ''
  return {
    enabled: true,
    ...(sourceLanguage ? {sourceLanguage} : {}),
    ...(hostname ? {hostname} : {}),
  }
}

function serializePageTranslationTabSession(session: PageTranslationTabSession): StoredPageTranslationTabSession {
  return session.sourceLanguage || session.hostname
    ? {
      enabled: true,
      ...(session.sourceLanguage ? {sourceLanguage: session.sourceLanguage} : {}),
      ...(session.hostname ? {hostname: session.hostname} : {}),
    }
    : true
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function sendErrorResponse(sendResponse: SendResponse, error: unknown, fallback: string): void {
  sendResponse({ok: false, error: getErrorMessage(error, fallback)})
}

function sendPromiseResponse<T>(
  sendResponse: SendResponse,
  promise: Promise<T>,
  mapResult: (result: T) => unknown,
  errorFallback: string,
): true {
  promise
    .then((result) => sendResponse(mapResult(result)))
    .catch((error: unknown) => sendErrorResponse(sendResponse, error, errorFallback))
  return true
}

async function readPageTranslationTabs(): Promise<Record<string, StoredPageTranslationTabSession>> {
  const stored = (await chrome.storage.local.get([PAGE_TRANSLATION_TABS_KEY]))[PAGE_TRANSLATION_TABS_KEY]
  return (stored as Record<string, StoredPageTranslationTabSession> | undefined) ?? {}
}

async function writePageTranslationTabs(tabs: Record<string, StoredPageTranslationTabSession>) {
  await chrome.storage.local.set({[PAGE_TRANSLATION_TABS_KEY]: tabs})
}

async function readPageTranslationPreferences(): Promise<PageTranslationPreferences> {
  const stored = (await chrome.storage.sync.get([PAGE_TRANSLATION_PREFS_KEY]))[PAGE_TRANSLATION_PREFS_KEY]
  return (stored as PageTranslationPreferences | undefined) ?? {}
}

async function writePageTranslationPreferences(prefs: PageTranslationPreferences) {
  await chrome.storage.sync.set({[PAGE_TRANSLATION_PREFS_KEY]: prefs})
}

async function readStoredPageTranslationGlobalPreference(): Promise<PageTranslationGlobalPreference> {
  const stored = (await chrome.storage.sync.get([PAGE_TRANSLATION_GLOBAL_PREFS_KEY]))[PAGE_TRANSLATION_GLOBAL_PREFS_KEY]
  return (stored as PageTranslationGlobalPreference | undefined) ?? {}
}

async function writePageTranslationGlobalPreference(preference: PageTranslationGlobalPreference) {
  if (Object.keys(preference.alwaysFrom ?? {}).length === 0) {
    await chrome.storage.sync.remove(PAGE_TRANSLATION_GLOBAL_PREFS_KEY)
    return
  }

  await chrome.storage.sync.set({[PAGE_TRANSLATION_GLOBAL_PREFS_KEY]: preference})
}

async function readPageTranslationGlobalPreference(): Promise<PageTranslationGlobalPreference> {
  const preference: PageTranslationGlobalPreference = {...(await readStoredPageTranslationGlobalPreference())}
  const prefs = await readPageTranslationPreferences()
  let migrated = false

  for (const [hostname, sitePreference] of Object.entries(prefs)) {
    const legacyAlwaysFrom = sitePreference.alwaysFrom ?? {}
    for (const [language, enabled] of Object.entries(legacyAlwaysFrom)) {
      if (!enabled) continue
      preference.alwaysFrom = {...(preference.alwaysFrom ?? {}), [language]: true}
      migrated = true
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
    await writePageTranslationPreferences(prefs)
    await writePageTranslationGlobalPreference(preference)
  }

  return preference
}

async function getPageTranslationSitePreference(hostname: string): Promise<PageTranslationSitePreference> {
  const prefs = await readPageTranslationPreferences()
  return prefs[normalizeSiteHostname(hostname)] ?? {}
}

async function getPageTranslationSitePreferenceForTab(tab: chrome.tabs.Tab): Promise<PageTranslationSitePreference> {
  const hostname = getHostnameFromUrl(tab.url)
  return hostname ? getPageTranslationSitePreference(hostname) : {}
}

function summarizePageTranslationPreference(
  hostname: string,
  preference: PageTranslationSitePreference,
  globalPreference: PageTranslationGlobalPreference
) {
  return {
    hostname,
    never: preference.never === true,
    alwaysFrom: Object.entries(globalPreference.alwaysFrom ?? {})
      .filter(([, enabled]) => enabled)
      .map(([language]) => language),
  }
}

async function disablePageTranslationForTab(tabId: number) {
  pageTranslationTabs.delete(tabId)

  const tabs = await readPageTranslationTabs()
  if (normalizePageTranslationTabSession(tabs[String(tabId)])) {
    delete tabs[String(tabId)]
    await writePageTranslationTabs(tabs)
  }

  void sendTabMessage(tabId, {type: 'SET_PAGE_TRANSLATION', enabled: false})
}

async function getPageTranslationTabSession(tabId: number, tab?: chrome.tabs.Tab): Promise<PageTranslationTabSession | null> {
  const settings = await readSettings()
  if (!supportsPageTranslation(settings.provider, settings)) {
    await disablePageTranslationForTab(tabId)
    return null
  }

  if (tab && (await getPageTranslationSitePreferenceForTab(tab)).never) {
    await disablePageTranslationForTab(tabId)
    return null
  }

  const cached = pageTranslationTabs.get(tabId)
  if (cached) {
    const currentHostname = tab ? getHostnameFromUrl(tab.url) : ''
    if (cached.hostname && currentHostname && cached.hostname !== currentHostname) {
      await disablePageTranslationForTab(tabId)
      return null
    }
    return cached
  }

  const tabs = await readPageTranslationTabs()
  const session = normalizePageTranslationTabSession(tabs[String(tabId)])
  if (session) {
    const currentHostname = tab ? getHostnameFromUrl(tab.url) : ''
    if (session.hostname && currentHostname && session.hostname !== currentHostname) {
      await disablePageTranslationForTab(tabId)
      return null
    }
    pageTranslationTabs.set(tabId, session)
  }

  return session
}

function resolveSourceLanguage(text: string, requestedSource: string, provider: string): string {
  if (requestedSource !== 'auto') return requestedSource

  const detected = detectTextLanguage(text)
  if (detected) return detected

  if (PROVIDERS_WITH_NATIVE_AUTO_SOURCE.has(normalizeProvider(provider))) return 'auto'

  throw new Error('Could not detect source language automatically')
}

async function translateText(request: TranslateRequestMessage): Promise<TranslateTextResult> {
  const settings = await readSettings()
  if (request.mode === 'page' && !supportsPageTranslation(settings.provider, settings)) {
    throw new Error(`${normalizeProvider(settings.provider)} cannot be used for page translation`)
  }

  const requestedSource = request.mode === 'page' && request.fromOverride
    ? request.fromOverride
    : request.mode === 'input'
      ? settings.translate_input_from
      : settings.translate_select_from
  const target = request.mode === 'input' ? settings.translate_input_to : settings.translate_select_to
  const provider = normalizeProvider(settings.provider)

  if (isTextLikelyLanguage(request.text, target)) {
    return {translatedText: request.text, skipped: true}
  }

  const source = resolveSourceLanguage(request.text, requestedSource, provider)
  const translatedText = await translateWithProvider(provider, {
    text: request.text,
    from: source,
    to: target,
    settings
  })
  return {translatedText}
}

async function precheckTranslateText(request: TranslatePrecheckMessage): Promise<TranslatePrecheckResult> {
  const settings = await readSettings()
  if (request.mode === 'page' && !supportsPageTranslation(settings.provider, settings)) {
    throw new Error(`${normalizeProvider(settings.provider)} cannot be used for page translation`)
  }

  const target = request.mode === 'input' ? settings.translate_input_to : settings.translate_select_to
  return {skipped: isTextLikelyLanguage(request.text, target)}
}

async function translateSidePanel(request: SidePanelTranslateMessage): Promise<string> {
  const settings = await readSettings()
  if (isTextLikelyLanguage(request.text, request.to)) return request.text

  const provider = normalizeProvider(request.provider)
  const source = resolveSourceLanguage(request.text, request.from, provider)
  return translateWithProvider(provider, {
    text: request.text,
    from: source,
    to: request.to,
    settings
  })
}

async function getActivePageTranslationState() {
  const globalPreference = await readPageTranslationGlobalPreference()
  const tab = await getActiveTab()
  if (tab?.id == null) {
    return {
      enabled: false,
      supported: false,
      disabledBySite: false,
      ...summarizePageTranslationPreference('', {}, globalPreference),
    }
  }
  if (!canTranslateTab(tab)) {
    return {
      enabled: false,
      supported: false,
      disabledBySite: false,
      ...summarizePageTranslationPreference('', {}, globalPreference),
    }
  }

  const settings = await readSettings()
  const supported = supportsPageTranslation(settings.provider, settings)
  const hostname = getHostnameFromUrl(tab.url)
  const preference = hostname ? await getPageTranslationSitePreference(hostname) : {}
  const preferenceSummary = summarizePageTranslationPreference(hostname, preference, globalPreference)
  const disabledBySite = preference.never === true
  if (!supported || disabledBySite) {
    await disablePageTranslationForTab(tab.id)
    return {enabled: false, supported, disabledBySite, ...preferenceSummary}
  }

  const session = await getPageTranslationTabSession(tab.id, tab)
  return {
    enabled: !!session,
    sourceLanguage: session?.sourceLanguage,
    supported,
    disabledBySite,
    ...preferenceSummary,
  }
}

async function setPageTranslationStateForTab(tab: chrome.tabs.Tab, enabled: boolean, sourceLanguage?: string): Promise<boolean> {
  if (tab?.id == null) {
    throw new Error('No active tab')
  }
  if (!canTranslateTab(tab)) {
    throw new Error('This page cannot be translated')
  }

  if (enabled) {
    const settings = await readSettings()
    if (!supportsPageTranslation(settings.provider, settings)) {
      throw new Error(`${normalizeProvider(settings.provider)} cannot be used for page translation`)
    }

    const preference = await getPageTranslationSitePreferenceForTab(tab)
    if (preference.never) {
      throw new Error('Page translation is disabled for this site')
    }
  }

  const normalizedSourceLanguage = sourceLanguage ? normalizeDetectableLanguage(sourceLanguage) : null
  const hostname = getHostnameFromUrl(tab.url)
  const session: PageTranslationTabSession = {
    enabled: true,
    ...(normalizedSourceLanguage ? {sourceLanguage: normalizedSourceLanguage} : {}),
    ...(hostname ? {hostname} : {}),
  }

  if (enabled) {
    pageTranslationTabs.set(tab.id, session)
  } else {
    pageTranslationTabs.delete(tab.id)
  }

  const tabs = await readPageTranslationTabs()
  if (enabled) {
    tabs[String(tab.id)] = serializePageTranslationTabSession(session)
    await writePageTranslationTabs(tabs)
  } else if (normalizePageTranslationTabSession(tabs[String(tab.id)])) {
    delete tabs[String(tab.id)]
    await writePageTranslationTabs(tabs)
  }

  void sendTabMessage(tab.id, {
    type: 'SET_PAGE_TRANSLATION',
    enabled,
    ...(enabled && normalizedSourceLanguage ? {sourceLanguage: normalizedSourceLanguage} : {}),
  })
  return enabled
}

async function setActivePageTranslationState(request: PageTranslationSetActiveMessage, senderTab?: chrome.tabs.Tab): Promise<boolean> {
  const tab = senderTab?.id != null ? senderTab : await getActiveTab()
  if (!tab) {
    throw new Error('No active tab')
  }

  return setPageTranslationStateForTab(tab, request.enabled, request.sourceLanguage)
}

async function getPageTranslationSuggestSettings(request: PageTranslationSuggestSettingsMessage) {
  const settings = await readSettings()
  const hostname = normalizeSiteHostname(request.hostname)
  const provider = normalizeProvider(settings.provider)
  const preference = hostname ? await getPageTranslationSitePreference(hostname) : {}
  const globalPreference = await readPageTranslationGlobalPreference()

  return {
    supported: supportsPageTranslation(provider, settings),
    target: settings.translate_select_to,
    ...summarizePageTranslationPreference(hostname, preference, globalPreference),
  }
}

async function setPageTranslationSitePreference(request: PageTranslationSetSitePreferenceMessage, senderTab?: chrome.tabs.Tab) {
  const hostname = normalizeSiteHostname(request.hostname)

  if (request.action === 'never') {
    if (!hostname) throw new Error('Invalid site')
    const prefs = await readPageTranslationPreferences()
    const preference: PageTranslationSitePreference = {...(prefs[hostname] ?? {})}
    preference.never = true

    prefs[hostname] = preference
    await writePageTranslationPreferences(prefs)

    if (senderTab?.id != null) {
      await disablePageTranslationForTab(senderTab.id)
    }

    const globalPreference = await readPageTranslationGlobalPreference()
    return summarizePageTranslationPreference(hostname, preference, globalPreference)
  }

  const language = request.language?.trim().toLowerCase()
  if (!language) throw new Error('Invalid language')

  const globalPreference = await readPageTranslationGlobalPreference()
  globalPreference.alwaysFrom = {...(globalPreference.alwaysFrom ?? {}), [language]: true}
  await writePageTranslationGlobalPreference(globalPreference)

  const preference = hostname ? await getPageTranslationSitePreference(hostname) : {}
  return summarizePageTranslationPreference(hostname, preference, globalPreference)
}

async function clearPageTranslationSitePreference(request: PageTranslationClearSitePreferenceMessage) {
  const hostname = normalizeSiteHostname(request.hostname)

  if (request.action === 'never') {
    if (!hostname) throw new Error('Invalid site')
    const prefs = await readPageTranslationPreferences()
    const preference: PageTranslationSitePreference = {...(prefs[hostname] ?? {})}
    delete preference.never

    if (!preference.never) {
      delete prefs[hostname]
    } else {
      prefs[hostname] = preference
    }

    await writePageTranslationPreferences(prefs)
    const globalPreference = await readPageTranslationGlobalPreference()
    return summarizePageTranslationPreference(hostname, preference, globalPreference)
  }

  const language = request.language?.trim().toLowerCase()
  if (!language) throw new Error('Invalid language')

  const globalPreference = await readPageTranslationGlobalPreference()
  if (globalPreference.alwaysFrom) {
    delete globalPreference.alwaysFrom[language]
    if (Object.keys(globalPreference.alwaysFrom).length === 0) {
      delete globalPreference.alwaysFrom
    }
  }
  await writePageTranslationGlobalPreference(globalPreference)

  const preference = hostname ? await getPageTranslationSitePreference(hostname) : {}
  return summarizePageTranslationPreference(hostname, preference, globalPreference)
}

function analyzePageTranslationSamples(request: PageTranslationAnalyzeSamplesMessage) {
  const targetLanguage = normalizeDetectableLanguage(request.target)
  if (!targetLanguage) return null

  const sourceWeights: Partial<Record<DetectableLanguage, number>> = {}
  const documentLanguage = normalizeDetectableLanguage(request.documentLanguage ?? '')
  let visibleWeight = 0
  let targetWeight = 0
  let totalWeight = 0
  let mismatchWeight = 0

  for (const sample of request.samples) {
    if (typeof sample !== 'string') continue

    const weight = getLanguageSampleWeight(sample)
    if (weight <= 0) continue

    visibleWeight += weight
    const isTargetLikely = isTextLikelyLanguage(sample, targetLanguage)
    if (isTargetLikely) targetWeight += weight

    const detected = detectTextLanguage(sample)
    if (!detected) continue

    totalWeight += weight

    const isTarget = detected === targetLanguage || isTargetLikely
    if (isTarget) continue

    mismatchWeight += weight
    sourceWeights[detected] = (sourceWeights[detected] ?? 0) + weight
  }

  if (totalWeight < PAGE_TRANSLATION_ANALYSIS_MIN_WEIGHT || mismatchWeight === 0) {
    const fallbackMismatchWeight = visibleWeight - targetWeight
    if (
      documentLanguage &&
      documentLanguage !== targetLanguage &&
      visibleWeight >= PAGE_TRANSLATION_ANALYSIS_MIN_WEIGHT &&
      fallbackMismatchWeight / visibleWeight >= 0.05
    ) {
      return {
        sourceLanguage: documentLanguage,
        mismatchRatio: fallbackMismatchWeight / visibleWeight,
        totalWeight: visibleWeight,
        mismatchWeight: fallbackMismatchWeight,
      }
    }

    return null
  }

  const sourceLanguage = (Object.entries(sourceWeights) as Array<[DetectableLanguage, number]>)
    .sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!sourceLanguage || sourceLanguage === targetLanguage) return null

  return {
    sourceLanguage,
    mismatchRatio: mismatchWeight / totalWeight,
    totalWeight,
    mismatchWeight,
  }
}

// message handler
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    sendResponse({ok: false, error: 'Invalid request'})
    return
  }

  const typed = message as Partial<RuntimeMessage>

  if (typed.type === 'PAGE_TRANSLATION_GET_STATE') {
    const tab = sender.tab
    const tabId = tab?.id
    if (tabId == null) {
      sendResponse({ok: true, enabled: false})
      return
    }

    return sendPromiseResponse(
      sendResponse,
      getPageTranslationTabSession(tabId, tab),
      (session) => ({ok: true, enabled: !!session, sourceLanguage: session?.sourceLanguage}),
      'Unknown page translation error',
    )
  }

  if (typed.type === 'PAGE_TRANSLATION_GET_ACTIVE') {
    return sendPromiseResponse(
      sendResponse,
      getActivePageTranslationState(),
      (state) => ({ok: true, ...state}),
      'Unknown page translation error',
    )
  }

  if (typed.type === 'PAGE_TRANSLATION_SET_ACTIVE' && typeof typed.enabled === 'boolean') {
    return sendPromiseResponse(
      sendResponse,
      setActivePageTranslationState(typed as PageTranslationSetActiveMessage, sender.tab),
      (enabled) => ({ok: true, enabled}),
      'Unknown page translation error',
    )
  }

  if (typed.type === 'PAGE_TRANSLATION_SUGGEST_SETTINGS' && typeof typed.hostname === 'string') {
    return sendPromiseResponse(
      sendResponse,
      getPageTranslationSuggestSettings(typed as PageTranslationSuggestSettingsMessage),
      (settings) => ({ok: true, ...settings}),
      'Unknown page translation error',
    )
  }

  if (
    typed.type === 'PAGE_TRANSLATION_SET_SITE_PREFERENCE' &&
    typeof typed.hostname === 'string' &&
    (typed.action === 'never' || typed.action === 'always-from')
  ) {
    return sendPromiseResponse(
      sendResponse,
      setPageTranslationSitePreference(typed as PageTranslationSetSitePreferenceMessage, sender.tab),
      (preference) => ({ok: true, ...preference}),
      'Unknown page translation error',
    )
  }

  if (
    typed.type === 'PAGE_TRANSLATION_CLEAR_SITE_PREFERENCE' &&
    typeof typed.hostname === 'string' &&
    (typed.action === 'never' || typed.action === 'always-from')
  ) {
    return sendPromiseResponse(
      sendResponse,
      clearPageTranslationSitePreference(typed as PageTranslationClearSitePreferenceMessage),
      (preference) => ({ok: true, ...preference}),
      'Unknown page translation error',
    )
  }

  if (typed.type === 'PAGE_TRANSLATION_ANALYZE_SAMPLES' && Array.isArray(typed.samples) && typeof typed.target === 'string') {
    try {
      sendResponse({ok: true, analysis: analyzePageTranslationSamples(typed as PageTranslationAnalyzeSamplesMessage)})
    } catch (error: unknown) {
      sendErrorResponse(sendResponse, error, 'Unknown page translation error')
    }
    return
  }

  if (typed.type === 'SIDEPANEL_TRANSLATE' && typeof typed.text === 'string') {
    return sendPromiseResponse(
      sendResponse,
      translateSidePanel(typed as SidePanelTranslateMessage),
      (translatedText) => ({ok: true, translatedText}),
      'Unknown translation error',
    )
  }

  if (typed.type === 'TRANSLATE_TEXT_PRECHECK' && typeof typed.text === 'string') {
    return sendPromiseResponse(
      sendResponse,
      precheckTranslateText(typed as TranslatePrecheckMessage),
      ({skipped}) => ({ok: true, skipped}),
      'Unknown translation error',
    )
  }

  if (typed.type !== 'TRANSLATE_TEXT' || typeof typed.text !== 'string') {
    sendResponse({ok: false, error: 'Invalid request'})
    return
  }

  return sendPromiseResponse(
    sendResponse,
    translateText(typed as TranslateRequestMessage),
    ({translatedText, skipped}) => ({ok: true, translatedText, skipped}),
    'Unknown translation error',
  )
})

chrome.tabs.onRemoved.addListener((tabId) => {
  pageTranslationTabs.delete(tabId)
  void readPageTranslationTabs()
    .then((tabs) => {
      delete tabs[String(tabId)]
      return writePageTranslationTabs(tabs)
    })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return

  void getPageTranslationTabSession(tabId, tab)
})

// command handler
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'translate-focused-input') {
    return
  }

  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tabId = tabs[0]?.id
    if (!tabId) {
      return
    }
    void chrome.tabs.sendMessage(tabId, {type: 'APPLY_TRANSFORM_TO_FOCUS'})
  })
})
