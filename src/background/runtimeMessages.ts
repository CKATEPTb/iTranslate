export type TranslateMode = 'selection' | 'input' | 'page'

export type TranslateRequestMessage = {
  type: 'TRANSLATE_TEXT'
  text: string
  mode: TranslateMode
  fromOverride?: string
}

export type TranslatePrecheckMessage = {
  type: 'TRANSLATE_TEXT_PRECHECK'
  text: string
  mode: TranslateMode
}

export type SidePanelTranslateMessage = {
  type: 'SIDEPANEL_TRANSLATE'
  text: string
  provider: string
  from: string
  to: string
}

export type PageTranslationGetActiveMessage = {
  type: 'PAGE_TRANSLATION_GET_ACTIVE'
}

export type PageTranslationSetActiveMessage = {
  type: 'PAGE_TRANSLATION_SET_ACTIVE'
  enabled: boolean
  sourceLanguage?: string
  persist?: boolean
}

export type PageTranslationGetStateMessage = {
  type: 'PAGE_TRANSLATION_GET_STATE'
}

export type PageTranslationSuggestSettingsMessage = {
  type: 'PAGE_TRANSLATION_SUGGEST_SETTINGS'
  hostname: string
}

export type PageTranslationSetSitePreferenceMessage = {
  type: 'PAGE_TRANSLATION_SET_SITE_PREFERENCE'
  hostname: string
  action: 'never' | 'always-from'
  language?: string
}

export type PageTranslationClearSitePreferenceMessage = {
  type: 'PAGE_TRANSLATION_CLEAR_SITE_PREFERENCE'
  hostname: string
  action: 'never' | 'always-from'
  language?: string
}

export type PageTranslationAnalyzeSamplesMessage = {
  type: 'PAGE_TRANSLATION_ANALYZE_SAMPLES'
  target: string
  samples: string[]
  documentLanguage?: string
}

export type RuntimeMessage =
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

export type TranslateTextResult = {
  translatedText: string
  skipped?: boolean
}

export type TranslatePrecheckResult = {
  skipped: boolean
}

export type SendResponse = (response?: unknown) => void
