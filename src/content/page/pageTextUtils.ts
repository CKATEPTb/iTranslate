const LEADING_WHITESPACE_PATTERN = /^\s*/
const TRAILING_WHITESPACE_PATTERN = /\s*$/
const LETTER_PATTERN = /[\p{L}]/u

export type TextParts = {
    leading: string
    value: string
    trailing: string
}

export function splitPreservingWhitespace(text: string): TextParts {
    const leading = LEADING_WHITESPACE_PATTERN.exec(text)?.[0] ?? ''
    const trailing = TRAILING_WHITESPACE_PATTERN.exec(text)?.[0] ?? ''
    return {
        leading,
        value: text.trim(),
        trailing,
    }
}

export function hasTranslatableText(text: string): boolean {
    return LETTER_PATTERN.test(text)
}
