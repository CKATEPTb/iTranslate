import {Store} from '#mini-jsx'
import {shareConfigValue} from './storePersistence.ts'

function createSharedStore(defaultValue: string, key: string): Store<string> {
  const store = new Store(defaultValue, key, 'local')
  shareConfigValue(key, store.state || defaultValue)
  store.use().subscribe(value => {
    shareConfigValue(key, value)
  })

  return store
}

export const ProviderStore = createSharedStore('Google', 'provider')
export const SidePanelProviderStore = createSharedStore('Google', 'sidepanel_provider')
export const SidePanelFromStore = createSharedStore('en', 'sidepanel_from')
export const SidePanelToStore = createSharedStore('ru', 'sidepanel_to')
export const TranslateSelectFromStore = createSharedStore('en', 'translate_select_from')
export const TranslateSelectToStore = createSharedStore('ru', 'translate_select_to')
export const TranslateInputFromStore = createSharedStore('ru', 'translate_input_from')
export const TranslateInputToStore = createSharedStore('en', 'translate_input_to')

export const SidePanelThemeStore = createSharedStore('dark', 'sidepanel_theme')
export const PopupThemeStore = createSharedStore('dark', 'popup_theme')

export const DeeplKeyStore = createSharedStore('', 'deepl-key')
export const GoogleKeyStore = createSharedStore('', 'google-key')
export const LibreUrlStore = createSharedStore('https://libretranslate.com/translate', 'libre-url')
export const LibreKeyStore = createSharedStore('', 'libre-key')
export const LingvanexKeyStore = createSharedStore('', 'lingvanex-key')
export const OpenAIURLStore = createSharedStore('http://localhost:11434/v1', 'openai-url')
export const OpenAIModelStore = createSharedStore('llama3.1', 'openai-model')
export const OpenAIKeyStore = createSharedStore('', 'openai-key')
export const OpenAIPromptStore = createSharedStore(
  'Translate the text from {FROM} to {TO}.\n\nReturn only the translation.\nNo explanations.\nNo extra text.',
  'openai-prompt'
)
