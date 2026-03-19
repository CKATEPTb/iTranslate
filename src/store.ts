import {Store} from 'nano-jsx'

const SYNC_CONFIG_KEY = 'itranslate-config'

const canSync = () => typeof chrome !== 'undefined' && !!chrome.storage?.sync
const isPopup = () => typeof document !== 'undefined'

const memory: Record<string, any> = {}

let timer: ReturnType<typeof setTimeout> | null = null

async function share(key: string, value: any) {
  value = typeof value === 'string' ? value : JSON.stringify(value)
  memory[key] = value

  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    if (!isPopup() || !canSync()) return
    const current = (await chrome.storage.sync.get([SYNC_CONFIG_KEY]))[SYNC_CONFIG_KEY] ?? {}
    await chrome.storage.sync.set({ [SYNC_CONFIG_KEY]: { ...current, ...memory } })
  }, 200)
}

const StoreProxy: typeof Store = new Proxy(Store, {
  construct(target, args, newTarget) {
    const instance = Reflect.construct(target, args, newTarget) as Store<string>
    const [defaultValue, key] = args as [string, string]
    void share(key, instance.state || defaultValue)
    instance.use().subscribe((value) => {
      void share(key, value)
    })

    return instance
  }
})

export const ProviderStore = new StoreProxy('DeepL', 'provider', 'local')
export const SidePanelProviderStore = new StoreProxy('DeepL', 'sidepanel_provider', 'local')
export const SidePanelFromStore = new StoreProxy('en', 'sidepanel_from', 'local')
export const SidePanelToStore = new StoreProxy('ru', 'sidepanel_to', 'local')
export const TranslateSelectFromStore = new StoreProxy('en', 'translate_select_from', 'local')
export const TranslateSelectToStore = new StoreProxy('ru', 'translate_select_to', 'local')
export const TranslateInputFromStore = new StoreProxy('ru', 'translate_input_from', 'local')
export const TranslateInputToStore = new StoreProxy('en', 'translate_input_to', 'local')

export const DeeplKeyStore = new StoreProxy('', 'deepl-key', 'local')
export const GoogleKeyStore = new StoreProxy('', 'google-key', 'local')
export const LibreUrlStore = new StoreProxy('https://libretranslate.com/translate', 'libre-url', 'local')
export const LibreKeyStore = new StoreProxy('', 'libre-key', 'local')
export const LingvanexKeyStore = new StoreProxy('', 'lingvanex-key', 'local')
export const OpenAIURLStore = new StoreProxy('http://localhost:11434/v1', 'openai-url', 'local')
export const OpenAIModelStore = new StoreProxy('llama3.1', 'openai-model', 'local')
export const OpenAIKeyStore = new StoreProxy('', 'openai-key', 'local')
export const OpenAIPromptStore = new StoreProxy(
  'Translate the text from {FROM} to {TO}.\n\nReturn only the translation.\nNo explanations.\nNo extra text.',
  'openai-prompt',
  'local'
)

export async function read() {
  const current: Record<string, any> = canSync()
    ? ((await chrome.storage.sync.get([SYNC_CONFIG_KEY]))[SYNC_CONFIG_KEY] ?? {})
    : {}
  Object.entries(memory).forEach(([key, value]) => {
    if (current[key] == null) {
      current[key] = value
    }
  })
  return current
}
