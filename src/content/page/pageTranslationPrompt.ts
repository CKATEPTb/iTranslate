import type {DetectableLanguage} from '../../languageDetection'
import {getPageTranslationPromptCopy} from './pagePromptCopy'
import {getPageTranslationPromptStyle} from './pagePromptStyle'

export const PAGE_TRANSLATION_PROMPT_ID = 'itranslate-page-translation-prompt'

const PAGE_TRANSLATION_PROMPT_STYLE_ID = 'itranslate-page-translation-prompt-style'
const PAGE_TRANSLATION_PROMPT_TIMEOUT_MS = 12000

type PageTranslationPromptControllerOptions = {
    isRuntimeValid: () => boolean
    handleRuntimeError: (error: unknown) => boolean
    onDismiss: () => void
    onTranslate: (sourceLanguage: DetectableLanguage) => void
    onNever: (hostname: string) => void
    onAlways: (hostname: string, sourceLanguage: DetectableLanguage) => void
}

export class PageTranslationPromptController {
    private readonly options: PageTranslationPromptControllerOptions
    private el: HTMLElement | null = null
    private progressEl: HTMLElement | null = null
    private countdownFrame: number | null = null
    private countdownDeadline = 0
    private themeListenerInstalled = false

    constructor(options: PageTranslationPromptControllerOptions) {
        this.options = options
    }

    isVisible() {
        return !!this.el
    }

    show(hostname: string, targetLanguage: DetectableLanguage, sourceLanguage: DetectableLanguage) {
        ensurePageTranslationPromptStyle()
        this.hide()

        const copy = getPageTranslationPromptCopy(targetLanguage, sourceLanguage, hostname)
        const prompt = document.createElement('div')
        prompt.id = PAGE_TRANSLATION_PROMPT_ID
        prompt.setAttribute('role', 'dialog')
        prompt.setAttribute('aria-label', copy.title)

        const row = document.createElement('div')
        row.className = 'itranslate-page-prompt-row'

        const titleWrap = document.createElement('div')
        titleWrap.className = 'itranslate-page-prompt-title-wrap'

        const title = document.createElement('p')
        title.className = 'itranslate-page-prompt-title'
        title.textContent = copy.title

        const context = document.createElement('span')
        context.className = 'itranslate-page-prompt-context'
        context.textContent = copy.context
        titleWrap.append(title, context)

        const close = createPageTranslationPromptButton('itranslate-page-prompt-close', '\u00d7', copy.close)
        row.append(titleWrap, close)

        const actions = document.createElement('div')
        actions.className = 'itranslate-page-prompt-actions'

        const translateButton = createPageTranslationPromptButton('itranslate-page-prompt-primary', copy.translate)
        const neverButton = createPageTranslationPromptButton('itranslate-page-prompt-secondary', copy.never, copy.neverTitle)
        const alwaysButton = createPageTranslationPromptButton('itranslate-page-prompt-secondary', copy.always, copy.alwaysTitle)

        const progress = document.createElement('div')
        progress.className = 'itranslate-page-prompt-progress'

        const progressBar = document.createElement('span')
        progressBar.className = 'itranslate-page-prompt-progress-bar'
        progress.append(progressBar)

        actions.append(translateButton, neverButton, alwaysButton)
        prompt.append(row, actions, progress)

        prompt.addEventListener('mouseenter', () => this.pauseCountdown())
        prompt.addEventListener('mouseleave', () => this.startCountdown())
        prompt.addEventListener('focusin', () => this.pauseCountdown())
        prompt.addEventListener('focusout', () => this.startCountdown())

        close.addEventListener('click', () => this.dismiss())
        translateButton.addEventListener('click', () => {
            this.dismiss()
            this.options.onTranslate(sourceLanguage)
        })
        neverButton.addEventListener('click', () => {
            this.dismiss()
            this.options.onNever(hostname)
        })
        alwaysButton.addEventListener('click', () => {
            this.dismiss()
            this.options.onAlways(hostname, sourceLanguage)
        })

        document.documentElement.appendChild(prompt)
        prompt.style.display = 'block'
        this.el = prompt
        this.progressEl = progressBar
        this.syncTheme()
        this.startCountdown()
    }

    hide() {
        this.clearCountdown()
        this.el?.remove()
        this.el = null
    }

    private dismiss() {
        this.options.onDismiss()
        this.hide()
    }

    private applyTheme(theme: unknown) {
        if (!this.el) return

        const light = theme === 'light'
        this.el.classList.toggle('itranslate-page-prompt-light', light)
        this.el.classList.toggle('itranslate-page-prompt-dark', !light)
    }

    private syncTheme() {
        this.applyTheme('dark')
        if (!this.options.isRuntimeValid()) return

        try {
            chrome.storage.local.get(['popup_theme'], (data) => {
                try {
                    if (chrome.runtime.lastError) {
                        this.options.handleRuntimeError(chrome.runtime.lastError.message)
                        return
                    }
                } catch (error) {
                    this.options.handleRuntimeError(error)
                    return
                }

                this.applyTheme(data['popup_theme'])
            })
        } catch (error) {
            this.options.handleRuntimeError(error)
        }

        if (this.themeListenerInstalled) return
        this.themeListenerInstalled = true

        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes['popup_theme']) {
                    this.applyTheme(changes['popup_theme'].newValue)
                }
            })
        } catch (error) {
            this.options.handleRuntimeError(error)
        }
    }

    private setProgress(ratio: number) {
        this.progressEl?.style.setProperty(
            '--itranslate-page-prompt-progress',
            String(Math.max(0, Math.min(1, ratio))),
        )
    }

    private clearCountdown() {
        if (this.countdownFrame !== null) {
            cancelAnimationFrame(this.countdownFrame)
            this.countdownFrame = null
        }
        this.countdownDeadline = 0
        this.progressEl = null
    }

    private readonly tickCountdown = () => {
        if (!this.el || !this.progressEl) return

        const remaining = this.countdownDeadline - Date.now()
        this.setProgress(remaining / PAGE_TRANSLATION_PROMPT_TIMEOUT_MS)

        if (remaining <= 0) {
            this.dismiss()
            return
        }

        this.countdownFrame = requestAnimationFrame(this.tickCountdown)
    }

    private startCountdown() {
        if (!this.el || !this.progressEl) return
        if (this.countdownFrame !== null) cancelAnimationFrame(this.countdownFrame)

        this.countdownDeadline = Date.now() + PAGE_TRANSLATION_PROMPT_TIMEOUT_MS
        this.setProgress(1)
        this.countdownFrame = requestAnimationFrame(this.tickCountdown)
    }

    private pauseCountdown() {
        if (this.countdownFrame !== null) {
            cancelAnimationFrame(this.countdownFrame)
            this.countdownFrame = null
        }
        this.countdownDeadline = Date.now() + PAGE_TRANSLATION_PROMPT_TIMEOUT_MS
        this.setProgress(1)
    }
}

function ensurePageTranslationPromptStyle() {
    if (document.getElementById(PAGE_TRANSLATION_PROMPT_STYLE_ID)) return

    const style = document.createElement('style')
    style.id = PAGE_TRANSLATION_PROMPT_STYLE_ID
    style.textContent = getPageTranslationPromptStyle(PAGE_TRANSLATION_PROMPT_ID)
    document.documentElement.appendChild(style)
}

function createPageTranslationPromptButton(className: string, text: string, label?: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = className
    button.type = 'button'
    button.textContent = text

    if (label) {
        button.title = label
        button.setAttribute('aria-label', label)
    }

    return button
}
