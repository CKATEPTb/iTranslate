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

function consumeLastError() {
  void chrome.runtime.lastError
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
  const updateMenuTitle = async () => {
    const title = await getContextMenuTitle(getTargetLanguage)
    chrome.contextMenus.update(PAGE_TRANSLATION_CONTEXT_MENU_ID, {title}, consumeLastError)
  }

  const createMenu = async () => {
    const title = await getContextMenuTitle(getTargetLanguage)
    chrome.contextMenus.create({
      id: PAGE_TRANSLATION_CONTEXT_MENU_ID,
      title,
      contexts: PAGE_TRANSLATION_CONTEXTS,
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
    }, consumeLastError)
  }

  const resetMenu = () => {
    chrome.contextMenus.remove(PAGE_TRANSLATION_CONTEXT_MENU_ID, () => {
      consumeLastError()
      void createMenu()
    })
  }

  resetMenu()
  chrome.runtime.onInstalled.addListener(resetMenu)
  chrome.runtime.onStartup.addListener(resetMenu)
  chrome.storage.onChanged.addListener((_, area) => {
    if (area === 'sync') void updateMenuTitle()
  })

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== PAGE_TRANSLATION_CONTEXT_MENU_ID || !tab) return
    void startPageTranslation(tab)
  })
}
