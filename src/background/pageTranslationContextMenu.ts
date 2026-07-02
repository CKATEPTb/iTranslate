const PAGE_TRANSLATION_CONTEXT_MENU_ID = 'itranslate-translate-page'
const PAGE_TRANSLATION_CONTEXTS: chrome.contextMenus.CreateProperties['contexts'] = [
  'page',
  'selection',
  'editable',
  'link',
]

const PAGE_TRANSLATION_CONTEXT_MENU_TITLES: Record<string, string> = {
  en: 'Translate with iTranslate',
  ru: 'Перевести с помощью iTranslate',
  ua: 'Перекласти за допомогою iTranslate',
  de: 'Mit iTranslate übersetzen',
  fr: 'Traduire avec iTranslate',
}

type StartPageTranslationFromContextMenu = (tab: chrome.tabs.Tab) => Promise<void>
type GetPageTranslationTargetLanguage = () => Promise<string | undefined>
type ContextMenuUpdateProperties = Parameters<typeof chrome.contextMenus.update>[1]

function readLastErrorMessage(): string | undefined {
  return chrome.runtime.lastError?.message
}

function removeAllContextMenus(): Promise<string | undefined> {
  return new Promise(resolve => {
    chrome.contextMenus.removeAll(() => resolve(readLastErrorMessage()))
  })
}

function createContextMenu(properties: chrome.contextMenus.CreateProperties): Promise<string | undefined> {
  return new Promise(resolve => {
    chrome.contextMenus.create(properties, () => resolve(readLastErrorMessage()))
  })
}

function updateContextMenu(
  id: string,
  properties: ContextMenuUpdateProperties,
): Promise<string | undefined> {
  return new Promise(resolve => {
    chrome.contextMenus.update(id, properties, () => resolve(readLastErrorMessage()))
  })
}

function normalizeTargetLanguage(language: string | undefined): string {
  return language?.trim().toLowerCase() || 'ru'
}

async function getContextMenuTitle(getTargetLanguage: GetPageTranslationTargetLanguage): Promise<string> {
  try {
    const target = normalizeTargetLanguage(await getTargetLanguage())
    return PAGE_TRANSLATION_CONTEXT_MENU_TITLES[target] ?? PAGE_TRANSLATION_CONTEXT_MENU_TITLES.en
  } catch {
    return PAGE_TRANSLATION_CONTEXT_MENU_TITLES.ru
  }
}

export function installPageTranslationContextMenu(
  startPageTranslation: StartPageTranslationFromContextMenu,
  getTargetLanguage: GetPageTranslationTargetLanguage,
) {
  let menuOperation = Promise.resolve()

  const queueMenuOperation = (operation: () => Promise<void>) => {
    menuOperation = menuOperation.then(operation, operation)
    return menuOperation
  }

  const rebuildMenu = async () => {
    const title = await getContextMenuTitle(getTargetLanguage)
    await removeAllContextMenus()
    await createContextMenu({
      id: PAGE_TRANSLATION_CONTEXT_MENU_ID,
      title,
      contexts: PAGE_TRANSLATION_CONTEXTS,
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
    })
  }

  const updateMenuTitle = async () => {
    const title = await getContextMenuTitle(getTargetLanguage)
    const error = await updateContextMenu(PAGE_TRANSLATION_CONTEXT_MENU_ID, {title})
    if (error) await rebuildMenu()
  }

  const resetMenu = () => void queueMenuOperation(rebuildMenu)
  resetMenu()
  chrome.runtime.onInstalled.addListener(() => resetMenu())
  chrome.runtime.onStartup.addListener(() => resetMenu())
  chrome.storage.onChanged.addListener((_, area) => {
    if (area === 'sync') void queueMenuOperation(updateMenuTitle)
  })

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== PAGE_TRANSLATION_CONTEXT_MENU_ID || !tab) return
    void startPageTranslation(tab)
  })
}
