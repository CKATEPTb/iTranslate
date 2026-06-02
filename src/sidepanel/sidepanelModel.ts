export const TARGET_LANGS = ['en', 'ru', 'ua', 'de', 'fr'] as const
export const SOURCE_LANGS = ['auto', ...TARGET_LANGS] as const

export type TargetLangCode = typeof TARGET_LANGS[number]
export type SourceLangCode = typeof SOURCE_LANGS[number]
export type LangCode = SourceLangCode | TargetLangCode

export const LANG_LABELS: Record<LangCode, string> = {
    auto: 'Auto detect',
    en: 'English',
    ru: 'Russian',
    ua: 'Ukrainian',
    de: 'German',
    fr: 'French',
}

export const HISTORY_KEY = 'sidepanel_history'
export const HISTORY_LIMIT = 100

export interface HistoryEntry {
    id: string
    provider: string
    from: string
    to: string
    source: string
    result: string
    timestamp: number
}

export function getFallbackTargetLanguage(excluded: string): TargetLangCode {
    return TARGET_LANGS.find(language => language !== excluded) ?? TARGET_LANGS[0]
}
