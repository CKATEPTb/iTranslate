import {normalizeProvider, supportsPageTranslation} from '../providers.ts'
import {isTextLikelyLanguage} from '../languageDetection.ts'
import {
  getHostnameFromUrl,
  normalizeSiteHostname,
  PageTranslationPreferenceStore,
  PageTranslationSessionStore,
  type PageTranslationTabSession,
} from './pageTranslationState.ts'
import {installPageTranslationContextMenu} from './pageTranslationContextMenu.ts'
import {normalizeDetectableLanguage} from './detectableLanguage.ts'
import {analyzePageTranslationSamples} from './pageTranslationAnalysis.ts'
import {
  canTranslateTab,
  getActiveTab,
  sendErrorResponse,
  sendPromiseResponse,
  sendTabMessage,
} from './runtimeChrome.ts'
import type {
  PageTranslationAnalyzeSamplesMessage,
  PageTranslationClearSitePreferenceMessage,
  PageTranslationSetActiveMessage,
  PageTranslationSetSitePreferenceMessage,
  PageTranslationSuggestSettingsMessage,
  RuntimeMessage,
  SidePanelTranslateMessage,
  TranslatePrecheckMessage,
  TranslatePrecheckResult,
  TranslateRequestMessage,
  TranslateTextResult,
} from './runtimeMessages.ts'
import {bindSettingsCacheInvalidation, readSettings} from './settingsCache.ts'
import {resolveSourceLanguage, translateWithProvider} from './translationRuntime.ts'

const pageTranslationPreferences = new PageTranslationPreferenceStore()
const pageTranslationSessions = new PageTranslationSessionStore(normalizeDetectableLanguage)

bindSettingsCacheInvalidation()

type PageTranslationActivationOptions = {
  ignoreSitePreference?: boolean
}

async function disablePageTranslationForTab(tabId: number) {
  await pageTranslationSessions.clear(tabId)
  void sendTabMessage(tabId, {type: 'SET_PAGE_TRANSLATION', enabled: false})
}

async function getPageTranslationTabSession(
  tabId: number,
  tab?: chrome.tabs.Tab,
  sender?: chrome.runtime.MessageSender,
): Promise<PageTranslationTabSession | null> {
  const settings = await readSettings()
  if (!supportsPageTranslation(settings.provider, settings)) {
    await disablePageTranslationForTab(tabId)
    return null
  }

  const cached = pageTranslationSessions.get(tabId)
  const sitePreference = tab ? await pageTranslationPreferences.getSiteForTab(tab) : {}
  if (tab && sitePreference.never && !cached?.ignoreSitePreference) {
    await disablePageTranslationForTab(tabId)
    return null
  }

  if (cached) {
    const currentHostname = tab ? getHostnameFromUrl(tab.url) : ''
    if (cached.hostname && currentHostname && cached.hostname !== currentHostname) {
      await disablePageTranslationForTab(tabId)
      return null
    }
    if (
      sender?.frameId === 0 &&
      cached.documentId &&
      sender.documentId &&
      cached.documentId !== sender.documentId
    ) {
      await pageTranslationSessions.clear(tabId)
      return null
    }
    return cached
  }

  // Active page translation is document-scoped. Older builds stored this state in
  // extension storage, which made a one-time "Translate" click survive reloads.
  // Clear any legacy tab session instead of restoring it.
  await pageTranslationSessions.clearLegacyStored(tabId)

  return null
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

async function getInactivePageTranslationState() {
  return {
    enabled: false,
    supported: false,
    disabledBySite: false,
    ...(await pageTranslationPreferences.summarize('')),
  }
}

async function getActivePageTranslationState() {
  const tab = await getActiveTab()
  if (tab?.id == null) {
    return getInactivePageTranslationState()
  }
  if (!canTranslateTab(tab)) {
    return getInactivePageTranslationState()
  }

  const settings = await readSettings()
  const supported = supportsPageTranslation(settings.provider, settings)
  const hostname = getHostnameFromUrl(tab.url)
  const preferenceSummary = await pageTranslationPreferences.summarize(hostname)
  const session = await getPageTranslationTabSession(tab.id, tab)
  const disabledBySite = preferenceSummary.never && !session?.ignoreSitePreference
  if (!supported || disabledBySite) {
    await disablePageTranslationForTab(tab.id)
    return {enabled: false, supported, disabledBySite, ...preferenceSummary}
  }

  return {
    enabled: !!session,
    sourceLanguage: session?.sourceLanguage,
    supported,
    disabledBySite,
    ...preferenceSummary,
  }
}

async function setPageTranslationStateForTab(
  tab: chrome.tabs.Tab,
  enabled: boolean,
  sourceLanguage?: string,
  persist = false,
  documentId?: string,
  options: PageTranslationActivationOptions = {},
): Promise<boolean> {
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

    const preference = await pageTranslationPreferences.getSiteForTab(tab)
    if (preference.never && !options.ignoreSitePreference) {
      throw new Error('Page translation is disabled for this site')
    }
  }

  const normalizedSourceLanguage = sourceLanguage ? normalizeDetectableLanguage(sourceLanguage) : null
  const hostname = getHostnameFromUrl(tab.url)
  const session: PageTranslationTabSession = {
    enabled: true,
    ...(normalizedSourceLanguage ? {sourceLanguage: normalizedSourceLanguage} : {}),
    ...(hostname ? {hostname} : {}),
    ...(documentId ? {documentId} : {}),
    ...(options.ignoreSitePreference ? {ignoreSitePreference: true} : {}),
  }

  if (enabled) {
    await pageTranslationSessions.set(tab.id, session, persist)
  } else {
    await pageTranslationSessions.clear(tab.id)
  }

  void sendTabMessage(tab.id, {
    type: 'SET_PAGE_TRANSLATION',
    enabled,
    ...(enabled && normalizedSourceLanguage ? {sourceLanguage: normalizedSourceLanguage} : {}),
  })
  return enabled
}

async function setActivePageTranslationState(request: PageTranslationSetActiveMessage, sender?: chrome.runtime.MessageSender): Promise<boolean> {
  const tab = sender?.tab?.id != null ? sender.tab : await getActiveTab()
  if (!tab) {
    throw new Error('No active tab')
  }

  return setPageTranslationStateForTab(tab, request.enabled, request.sourceLanguage, request.persist === true, sender?.documentId)
}

async function startPageTranslationFromContextMenu(tab: chrome.tabs.Tab): Promise<void> {
  await setPageTranslationStateForTab(tab, true, undefined, false, undefined, {ignoreSitePreference: true})
}

async function getPageTranslationTargetLanguage(): Promise<string | undefined> {
  return (await readSettings()).translate_select_to
}

async function getPageTranslationSuggestSettings(request: PageTranslationSuggestSettingsMessage) {
  const settings = await readSettings()
  const hostname = normalizeSiteHostname(request.hostname)
  const provider = normalizeProvider(settings.provider)

  return {
    supported: supportsPageTranslation(provider, settings),
    target: settings.translate_select_to,
    ...(await pageTranslationPreferences.summarize(hostname)),
  }
}

async function setPageTranslationSitePreference(request: PageTranslationSetSitePreferenceMessage, senderTab?: chrome.tabs.Tab) {
  const hostname = normalizeSiteHostname(request.hostname)

  if (request.action === 'never') {
    if (!hostname) throw new Error('Invalid site')
    const summary = await pageTranslationPreferences.setNever(hostname)

    if (senderTab?.id != null) {
      await disablePageTranslationForTab(senderTab.id)
    }

    return summary
  }

  const language = request.language?.trim().toLowerCase()
  if (!language) throw new Error('Invalid language')

  await pageTranslationPreferences.setAlwaysFrom(language)
  return pageTranslationPreferences.summarize(hostname)
}

async function clearPageTranslationSitePreference(request: PageTranslationClearSitePreferenceMessage) {
  const hostname = normalizeSiteHostname(request.hostname)

  if (request.action === 'never') {
    if (!hostname) throw new Error('Invalid site')
    return pageTranslationPreferences.clearNever(hostname)
  }

  const language = request.language?.trim().toLowerCase()
  if (!language) throw new Error('Invalid language')

  await pageTranslationPreferences.clearAlwaysFrom(language)
  return pageTranslationPreferences.summarize(hostname)
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
      getPageTranslationTabSession(tabId, tab, sender),
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
      setActivePageTranslationState(typed as PageTranslationSetActiveMessage, sender),
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
  void pageTranslationSessions.clear(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    void pageTranslationSessions.clear(tabId)
  }
})

installPageTranslationContextMenu(startPageTranslationFromContextMenu, getPageTranslationTargetLanguage)

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
