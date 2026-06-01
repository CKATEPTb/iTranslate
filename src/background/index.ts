import {read} from '../store.ts'
import {getTranslator} from './translator'

type TranslateMode = 'selection' | 'input'

type TranslateRequestMessage = {
  type: 'TRANSLATE_TEXT'
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
}

type PageTranslationGetStateMessage = {
  type: 'PAGE_TRANSLATION_GET_STATE'
}

const PAGE_TRANSLATION_TABS_KEY = 'itranslate-page-translation-tabs'
const pageTranslationTabs = new Map<number, boolean>()

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise(resolve => {
    chrome.tabs.query({active: true, currentWindow: true}, tabs => resolve(tabs[0]))
  })
}

function sendTabMessage(tabId: number, message: unknown): Promise<void> {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError
      resolve()
    })
  })
}

async function readPageTranslationTabs(): Promise<Record<string, boolean>> {
  return (await chrome.storage.local.get([PAGE_TRANSLATION_TABS_KEY]))[PAGE_TRANSLATION_TABS_KEY] ?? {}
}

async function writePageTranslationTabs(tabs: Record<string, boolean>) {
  await chrome.storage.local.set({[PAGE_TRANSLATION_TABS_KEY]: tabs})
}

async function isPageTranslationEnabled(tabId: number): Promise<boolean> {
  if (pageTranslationTabs.get(tabId) === true) {
    return true
  }

  const tabs = await readPageTranslationTabs()
  const enabled = tabs[String(tabId)] === true
  if (enabled) {
    pageTranslationTabs.set(tabId, true)
  }
  return enabled
}

async function translateText(request: TranslateRequestMessage): Promise<string> {
  const settings = await read()
  const source = request.mode === 'selection' ? settings.translate_select_from : settings.translate_input_from
  const target = request.mode === 'selection' ? settings.translate_select_to : settings.translate_input_to

  return getTranslator(settings.provider).translate({
    text: request.text,
    from: source,
    to: target,
    settings
  })
}

async function translateSidePanel(request: SidePanelTranslateMessage): Promise<string> {
  const settings = await read()
  return getTranslator(request.provider).translate({
    text: request.text,
    from: request.from,
    to: request.to,
    settings
  })
}

async function getActivePageTranslationState(): Promise<boolean> {
  const tab = await getActiveTab()
  if (tab?.id == null) {
    return false
  }
  return isPageTranslationEnabled(tab.id)
}

async function setActivePageTranslationState(request: PageTranslationSetActiveMessage): Promise<boolean> {
  const tab = await getActiveTab()
  if (tab?.id == null) {
    throw new Error('No active tab')
  }

  if (request.enabled) {
    pageTranslationTabs.set(tab.id, true)
  } else {
    pageTranslationTabs.delete(tab.id)
  }

  const tabs = await readPageTranslationTabs()
  if (request.enabled) {
    tabs[String(tab.id)] = true
  } else {
    delete tabs[String(tab.id)]
  }
  await writePageTranslationTabs(tabs)

  await sendTabMessage(tab.id, {type: 'SET_PAGE_TRANSLATION', enabled: request.enabled})
  return request.enabled
}

// message handler
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    sendResponse({ok: false, error: 'Invalid request'})
    return
  }

  const typed: any = message as Partial<TranslateRequestMessage & SidePanelTranslateMessage & PageTranslationGetActiveMessage & PageTranslationSetActiveMessage & PageTranslationGetStateMessage>

  if (typed.type === 'PAGE_TRANSLATION_GET_STATE') {
    const tabId = sender.tab?.id
    if (tabId == null) {
      sendResponse({ok: true, enabled: false})
      return
    }

    isPageTranslationEnabled(tabId)
      .then((enabled) => sendResponse({ok: true, enabled}))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : 'Unknown page translation error'
        sendResponse({ok: false, error: messageText})
      })
    return true
  }

  if (typed.type === 'PAGE_TRANSLATION_GET_ACTIVE') {
    getActivePageTranslationState()
      .then((enabled) => sendResponse({ok: true, enabled}))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : 'Unknown page translation error'
        sendResponse({ok: false, error: messageText})
      })
    return true
  }

  if (typed.type === 'PAGE_TRANSLATION_SET_ACTIVE' && typeof typed.enabled === 'boolean') {
    setActivePageTranslationState(typed as PageTranslationSetActiveMessage)
      .then((enabled) => sendResponse({ok: true, enabled}))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : 'Unknown page translation error'
        sendResponse({ok: false, error: messageText})
      })
    return true
  }

  if (typed.type === 'SIDEPANEL_TRANSLATE' && typeof typed.text === 'string') {
    translateSidePanel(typed as SidePanelTranslateMessage)
      .then((translatedText) => sendResponse({ok: true, translatedText}))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : 'Unknown translation error'
        sendResponse({ok: false, error: messageText})
      })
    return true
  }

  if (typed.type !== 'TRANSLATE_TEXT' || typeof typed.text !== 'string') {
    sendResponse({ok: false, error: 'Invalid request'})
    return
  }

  translateText(typed as TranslateRequestMessage)
      .then((translatedText) => sendResponse({ok: true, translatedText}))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : 'Unknown translation error'
        sendResponse({ok: false, error: messageText})
      })

  return true
})

chrome.tabs.onRemoved.addListener((tabId) => {
  pageTranslationTabs.delete(tabId)
  void readPageTranslationTabs()
    .then((tabs) => {
      delete tabs[String(tabId)]
      return writePageTranslationTabs(tabs)
    })
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
