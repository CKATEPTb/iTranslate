import {getVisibleSelectionExtract} from './dom/domUtils'
import {InputTranslationController} from './input/InputTranslationController'
import {PageTranslationService} from './page/PageTranslationService'
import {SelectionTranslationController} from './selection/SelectionTranslationController'
import {FloatingTooltip, type TooltipController} from './ui/FloatingTooltip'

type TranslateMode = 'selection' | 'input' | 'page'
type DetectableLanguage = 'en' | 'ru' | 'ua' | 'de' | 'fr'
type TranslateResponse = { ok: true; translatedText: string; skipped?: boolean } | { ok: false; error?: string }
type TranslatePrecheckResponse = { ok: true; skipped: boolean } | { ok: false; error?: string }
type RuntimeMessageResult<T> = {response?: T; error?: string; contextInvalidated?: boolean}

const STATUS_ID = 'itranslate-status'
const STATUS_STYLE_ID = 'itranslate-status-style'
let extensionContextValid = true
let pageTranslationService: PageTranslationService | null = null
let sharedTooltip: TooltipController | null = null

function isExtensionContextInvalidatedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    return /extension context invalidated/i.test(message)
}

function deactivateExtensionContext() {
    if (!extensionContextValid) return

    extensionContextValid = false
    try {
        pageTranslationService?.handleRuntimeInvalidated()
        hideTranslationStatus('input')
        hideTranslationStatus('page')
    } catch {
        // The old content script is being detached; keep teardown best-effort.
    }
}

function handleExtensionContextError(error: unknown): boolean {
    if (!isExtensionContextInvalidatedError(error)) return false

    deactivateExtensionContext()
    return true
}

function hasExtensionContext(): boolean {
    try {
        return extensionContextValid && typeof chrome !== 'undefined' && !!chrome.runtime?.id
    } catch (error) {
        handleExtensionContextError(error)
        return false
    }
}

function sendRuntimeMessage<T>(message: unknown): Promise<RuntimeMessageResult<T>> {
    return new Promise(resolve => {
        if (!hasExtensionContext()) {
            deactivateExtensionContext()
            resolve({contextInvalidated: true, error: 'Extension context invalidated'})
            return
        }

        try {
            chrome.runtime.sendMessage(message, (response: T | undefined) => {
                try {
                    const lastError = chrome.runtime.lastError
                    if (lastError) {
                        const error = lastError.message
                        resolve({
                            error,
                            contextInvalidated: handleExtensionContextError(error),
                        })
                        return
                    }
                } catch (error) {
                    resolve({
                        error: error instanceof Error ? error.message : String(error),
                        contextInvalidated: handleExtensionContextError(error),
                    })
                    return
                }

                resolve({response})
            })
        } catch (error) {
            resolve({
                error: error instanceof Error ? error.message : String(error),
                contextInvalidated: handleExtensionContextError(error),
            })
        }
    })
}

const translateWithResponse = async (
    text: string,
    mode: TranslateMode,
    fromOverride?: string,
): Promise<TranslateResponse> => {
    const result = await sendRuntimeMessage<TranslateResponse>({type: 'TRANSLATE_TEXT', text, mode, fromOverride})
    if (result.contextInvalidated) return {ok: false, error: 'Extension context invalidated'}
    if (result.error) return {ok: false, error: result.error}
    return result.response ?? {ok: false, error: 'Translation failed'}
}

const precheckTranslateWithResponse = async (text: string, mode: TranslateMode): Promise<TranslatePrecheckResponse> => {
    const result = await sendRuntimeMessage<TranslatePrecheckResponse>({type: 'TRANSLATE_TEXT_PRECHECK', text, mode})
    if (result.contextInvalidated) return {ok: false, error: 'Extension context invalidated'}
    if (result.error) return {ok: false, error: result.error}
    return result.response ?? {ok: false, error: 'Translation precheck failed'}
}

const translate = async (text: string, mode: TranslateMode): Promise<string | null> => {
    const response = await translateWithResponse(text, mode)
    return response.ok && !response.skipped && typeof response.translatedText === 'string' ? response.translatedText : null
}

type TranslationStatusKey = 'input' | 'page'

const translationStatuses = new Map<TranslationStatusKey, string>()

let translationStatusEl: HTMLElement | null = null
let translationStatusTextEl: HTMLElement | null = null
let translationStatusHideTimer: number | null = null
function ensureTranslationStatus() {
    if (!document.getElementById(STATUS_STYLE_ID)) {
        const style = document.createElement('style')
        style.id = STATUS_STYLE_ID
        style.textContent = `@keyframes itranslate-spin{to{transform:rotate(360deg)}}#${STATUS_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:none;align-items:center;gap:8px;max-width:min(320px,calc(100vw - 32px));padding:9px 12px;border-radius:12px;background:rgba(15,23,42,.88);color:#f8fafc;border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 32px rgba(15,23,42,.32);font:13px/1.35 -apple-system,"Segoe UI",sans-serif;pointer-events:none;backdrop-filter:blur(16px) saturate(160%);-webkit-backdrop-filter:blur(16px) saturate(160%)}#${STATUS_ID} .itranslate-status-spinner{width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:999px;animation:itranslate-spin .75s linear infinite;flex:0 0 auto}#${STATUS_ID} .itranslate-status-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`
        document.documentElement.appendChild(style)
    }

    if (translationStatusEl?.isConnected && translationStatusTextEl?.isConnected) return

    const el = document.createElement('div')
    el.id = STATUS_ID
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')

    const spinner = document.createElement('span')
    spinner.className = 'itranslate-status-spinner'

    const text = document.createElement('span')
    text.className = 'itranslate-status-text'

    el.append(spinner, text)
    document.documentElement.appendChild(el)
    translationStatusEl = el
    translationStatusTextEl = text
}

function renderTranslationStatus() {
    if (translationStatuses.size === 0) {
        if (translationStatusHideTimer !== null) clearTimeout(translationStatusHideTimer)
        translationStatusHideTimer = window.setTimeout(() => {
            if (translationStatusEl) translationStatusEl.style.display = 'none'
        }, 150)
        return
    }

    ensureTranslationStatus()
    if (translationStatusHideTimer !== null) {
        clearTimeout(translationStatusHideTimer)
        translationStatusHideTimer = null
    }

    const messages = Array.from(translationStatuses.values())
    if (translationStatusTextEl) {
        translationStatusTextEl.textContent = messages.length > 1 ? 'Please wait, translating...' : messages[0]
    }
    if (translationStatusEl) {
        translationStatusEl.style.display = 'flex'
    }
}

function showTranslationStatus(key: TranslationStatusKey, message: string) {
    translationStatuses.set(key, message)
    renderTranslationStatus()
}

function hideTranslationStatus(key: TranslationStatusKey) {
    translationStatuses.delete(key)
    renderTranslationStatus()
}

function getSharedTooltip(): TooltipController {
    sharedTooltip ??= new FloatingTooltip(handleExtensionContextError)
    return sharedTooltip
}

function normalizeDetectableLanguage(language: unknown): DetectableLanguage | null {
    if (typeof language !== 'string') return null

    const normalized = language.trim().toLowerCase()
    if (normalized === 'en' || normalized === 'ru' || normalized === 'ua' || normalized === 'de' || normalized === 'fr') {
        return normalized
    }
    return null
}

function registerBackgroundMessageHandler(
    inputController: InputTranslationController,
    pageController: PageTranslationService,
) {
    try {
        chrome.runtime.onMessage.addListener((msg: unknown) => {
            const typed = msg as { type?: string; enabled?: boolean; sourceLanguage?: string }
            if (typed.type === 'APPLY_TRANSFORM_TO_FOCUS') void inputController.transformFocused()
            if (typed.type === 'SET_PAGE_TRANSLATION' && typeof typed.enabled === 'boolean') {
                const sourceLanguage = normalizeDetectableLanguage(typed.sourceLanguage)
                typed.enabled ? pageController.start(sourceLanguage) : pageController.stop()
            }
        })
    } catch (error) {
        handleExtensionContextError(error)
    }
}

function startContentScript() {
    pageTranslationService = new PageTranslationService({
        sendRuntimeMessage,
        translateWithResponse,
        showStatus: showTranslationStatus,
        hideStatus: hideTranslationStatus,
        handleRuntimeError: handleExtensionContextError,
        isRuntimeValid: () => extensionContextValid,
        getTooltip: getSharedTooltip,
    })

    new SelectionTranslationController({
        tooltip: getSharedTooltip(),
        getVisibleSelectionExtract: (selection, point) => getVisibleSelectionExtract(selection, point),
        precheck: text => precheckTranslateWithResponse(text, 'selection'),
        translate: text => translateWithResponse(text, 'selection'),
        isRuntimeValid: () => extensionContextValid,
    }).start()
    const inputTranslationController = new InputTranslationController({
        translate: text => translate(text, 'input'),
        showStatus: message => showTranslationStatus('input', message),
        hideStatus: () => hideTranslationStatus('input'),
    })
    registerBackgroundMessageHandler(inputTranslationController, pageTranslationService)
    pageTranslationService.observeMutations()
    pageTranslationService.registerStateSync()
    pageTranslationService.syncState()
    pageTranslationService.startSuggestionObserver()
    pageTranslationService.scheduleSuggestion(1200, true)
    window.addEventListener('load', () => {
        pageTranslationService?.startSuggestionObserver()
        pageTranslationService?.scheduleSuggestion(800, true)
    }, {once: true})
    window.addEventListener('pageshow', () => {
        pageTranslationService?.startSuggestionObserver()
        pageTranslationService?.scheduleSuggestion(700, true)
    })
    window.addEventListener('focus', () => {
        pageTranslationService?.startSuggestionObserver()
        pageTranslationService?.scheduleSuggestion(900, true)
    })
    window.setTimeout(() => pageTranslationService?.scheduleSuggestion(0, true), 3500)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            pageTranslationService?.startSuggestionObserver()
            pageTranslationService?.scheduleSuggestion(700, true)
        }
    })
}

function startWhenDocumentElementReady() {
    if (document.documentElement) {
        startContentScript()
        return
    }

    const observer = new MutationObserver(() => {
        if (!document.documentElement) return

        observer.disconnect()
        startContentScript()
    })
    observer.observe(document, {childList: true})
}

startWhenDocumentElementReady()
