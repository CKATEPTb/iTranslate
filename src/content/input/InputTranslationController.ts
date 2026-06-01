type InputTranslationControllerOptions = {
    translate(text: string): Promise<string | null>
    showStatus(message: string): void
    hideStatus(): void
}

const INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password'])

export class InputTranslationController {
    private readonly translate: InputTranslationControllerOptions['translate']
    private readonly showStatus: InputTranslationControllerOptions['showStatus']
    private readonly hideStatus: InputTranslationControllerOptions['hideStatus']

    constructor(options: InputTranslationControllerOptions) {
        this.translate = options.translate
        this.showStatus = options.showStatus
        this.hideStatus = options.hideStatus
    }

    async transformFocused() {
        const editable = this.getEditable()
        if (!editable) return

        this.showStatus('Please wait, translating input...')
        try {
            if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
                await this.transformInput(editable)
                return
            }

            await this.transformContentEditable(editable)
        } finally {
            this.hideStatus()
        }
    }

    private fireInput(element: HTMLElement) {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const proto = element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype
            Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, element.value)
        }
        element.dispatchEvent(new InputEvent('input', {bubbles: true, cancelable: true, inputType: 'insertText'}))
        element.dispatchEvent(new Event('change', {bubbles: true}))
    }

    private getDeepActiveElement(root: Document | ShadowRoot = document): Element | null {
        const active = root.activeElement
        if (!active) return null
        return active.shadowRoot ? this.getDeepActiveElement(active.shadowRoot) : active
    }

    private getEditable(): HTMLElement | null {
        const element = this.getDeepActiveElement()
        if (!(element instanceof HTMLElement)) return null
        if (element instanceof HTMLTextAreaElement) return element
        if (element instanceof HTMLInputElement && !element.disabled && !element.readOnly && INPUT_TYPES.has(element.type)) {
            return element
        }
        if (element.isContentEditable) return element
        if (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') return element
        return null
    }

    private async transformInput(element: HTMLInputElement | HTMLTextAreaElement) {
        const {value} = element
        const selectionStart = element.selectionStart ?? 0
        const selectionEnd = element.selectionEnd ?? selectionStart
        const hasSelection = selectionEnd > selectionStart
        const text = (hasSelection ? value.slice(selectionStart, selectionEnd) : value).trim()
        if (!text) return

        const translated = await this.translate(text)
        if (translated === null) return

        element.value = hasSelection
            ? value.slice(0, selectionStart) + translated + value.slice(selectionEnd)
            : translated
        element.setSelectionRange(selectionStart + translated.length, selectionStart + translated.length)
        this.fireInput(element)
    }

    private async transformContentEditable(element: HTMLElement) {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return

        const hasSelection = !selection.isCollapsed && element.contains(selection.anchorNode)
        const text = (hasSelection ? selection.toString() : element.textContent ?? '').trim()
        if (!text) return

        const savedRange = selection.getRangeAt(0).cloneRange()
        const translated = await this.translate(text)
        if (translated === null) return

        element.focus()
        selection.removeAllRanges()

        if (hasSelection) {
            selection.addRange(savedRange)
        } else {
            const fullRange = document.createRange()
            fullRange.selectNodeContents(element)
            selection.addRange(fullRange)
        }

        const beforeInputFired = element.dispatchEvent(
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: translated,
            })
        )

        if (!beforeInputFired) return

        const inserted = document.execCommand('insertText', false, translated)
        if (inserted) return

        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : savedRange
        range.deleteContents()
        const node = document.createTextNode(translated)
        range.insertNode(node)
        range.selectNodeContents(node)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
        this.fireInput(element)
    }
}
