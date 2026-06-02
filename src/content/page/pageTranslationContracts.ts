import type {DetectableLanguage} from '../../languageDetection'
import type {TooltipController} from '../ui/FloatingTooltip'
import type {PageLanguageAnalysis} from './pageLanguageAnalysis'

export type TranslateMode = 'selection' | 'input' | 'page'

export type TranslateResponse =
    | { ok: true; translatedText: string; skipped?: boolean }
    | { ok: false; error?: string }

export type RuntimeMessageResult<T> = {
    response?: T
    error?: string
    contextInvalidated?: boolean
}

export type TranslationStatusKey = 'input' | 'page'

export type PageTranslationServiceOptions = {
    sendRuntimeMessage<T>(message: unknown): Promise<RuntimeMessageResult<T>>
    translateWithResponse(text: string, mode: TranslateMode, fromOverride?: string): Promise<TranslateResponse>
    showStatus(key: TranslationStatusKey, message: string): void
    hideStatus(key: TranslationStatusKey): void
    handleRuntimeError(error: unknown): boolean
    isRuntimeValid(): boolean
    getTooltip(): TooltipController
}

export type PageTranslationStateResponse = {
    ok: boolean
    enabled?: boolean
    sourceLanguage?: string
    error?: string
}

export type PageTranslationSuggestSettingsResponse = {
    ok: boolean
    supported?: boolean
    target?: string
    hostname?: string
    never?: boolean
    alwaysFrom?: string[]
    error?: string
}

export type PageTranslationAnalyzeSamplesResponse = {
    ok: boolean
    analysis?: PageLanguageAnalysis | null
    error?: string
}

export type PageTranslationAnalyzeSamplesRequest = {
    type: 'PAGE_TRANSLATION_ANALYZE_SAMPLES'
    target: DetectableLanguage
    samples: string[]
    documentLanguage?: DetectableLanguage
}

export type PageTranslationSetSitePreferenceResponse = {
    ok: boolean
    hostname?: string
    never?: boolean
    alwaysFrom?: string[]
    error?: string
}

export type PageTextMeta = {
    runId: number
    sourceText: string
    sourceValue: string
    translatedValue: string
    translatedText: string
}

export type PagePlaceholderElement = HTMLInputElement | HTMLTextAreaElement

export type PagePlaceholderMeta = {
    runId: number
    sourceText: string
    sourceValue: string
    translatedValue: string
    translatedText: string
}

export type {PageLanguageAnalysis}
