import type {DetectableLanguage} from '../../languageDetection'

type PromptCopy = {
    title: string
    context: string
    translate: string
    never: string
    always: string
    neverTitle: string
    alwaysTitle: string
    close: string
}

const PAGE_PROMPT_LANGUAGE_ALIASES: Record<string, DetectableLanguage> = {
    en: 'en',
    eng: 'en',
    english: 'en',
    ru: 'ru',
    rus: 'ru',
    russian: 'ru',
    uk: 'ua',
    ua: 'ua',
    ukr: 'ua',
    ukrainian: 'ua',
    de: 'de',
    deu: 'de',
    ger: 'de',
    german: 'de',
    fr: 'fr',
    fra: 'fr',
    fre: 'fr',
    french: 'fr',
}

const PAGE_PROMPT_FROM_LANGUAGE_NAMES: Record<DetectableLanguage, Record<DetectableLanguage, string>> = {
    en: {
        en: 'English',
        ru: 'Russian',
        ua: 'Ukrainian',
        de: 'German',
        fr: 'French',
    },
    ru: {
        en: 'английского',
        ru: 'русского',
        ua: 'украинского',
        de: 'немецкого',
        fr: 'французского',
    },
    ua: {
        en: 'англійської',
        ru: 'російської',
        ua: 'української',
        de: 'німецької',
        fr: 'французької',
    },
    de: {
        en: 'Englisch',
        ru: 'Russisch',
        ua: 'Ukrainisch',
        de: 'Deutsch',
        fr: 'Französisch',
    },
    fr: {
        en: "l'anglais",
        ru: 'le russe',
        ua: "l'ukrainien",
        de: "l'allemand",
        fr: 'le français',
    },
}

const PAGE_PROMPT_LANGUAGE_CODES: Record<DetectableLanguage, string> = {
    en: 'EN',
    ru: 'RU',
    ua: 'UA',
    de: 'DE',
    fr: 'FR',
}

export function parsePromptLanguage(language: string | undefined | null): DetectableLanguage | null {
    if (!language) return null

    const normalized = language.trim().toLowerCase()
    if (!normalized) return null

    for (const part of normalized.split(/[,;]/)) {
        const token = part.trim()
        if (!token) continue

        const primary = token.split(/[-_\s]/)[0]
        const parsed = PAGE_PROMPT_LANGUAGE_ALIASES[token] ?? PAGE_PROMPT_LANGUAGE_ALIASES[primary]
        if (parsed) return parsed
    }

    return null
}

export function normalizePromptLanguage(language: string | undefined): DetectableLanguage {
    return parsePromptLanguage(language) ?? 'en'
}

export function getPageTranslationPromptCopy(
    targetLanguage: DetectableLanguage,
    sourceLanguage: DetectableLanguage,
    hostname: string,
): PromptCopy {
    const source = PAGE_PROMPT_FROM_LANGUAGE_NAMES[targetLanguage][sourceLanguage]
    const context = `${hostname} · ${PAGE_PROMPT_LANGUAGE_CODES[sourceLanguage]} -> ${PAGE_PROMPT_LANGUAGE_CODES[targetLanguage]}`

    if (targetLanguage === 'ru') {
        return {
            title: 'Перевести страницу?',
            context,
            translate: 'Перевести',
            never: 'Никогда',
            always: 'Всегда',
            neverTitle: `Никогда не переводить ${hostname}`,
            alwaysTitle: `Всегда переводить с ${source}`,
            close: 'Закрыть',
        }
    }

    if (targetLanguage === 'ua') {
        return {
            title: 'Перекласти сторінку?',
            context,
            translate: 'Перекласти',
            never: 'Ніколи',
            always: 'Завжди',
            neverTitle: `Ніколи не перекладати ${hostname}`,
            alwaysTitle: `Завжди перекладати з ${source}`,
            close: 'Закрити',
        }
    }

    if (targetLanguage === 'de') {
        return {
            title: 'Seite übersetzen?',
            context,
            translate: 'Übersetzen',
            never: 'Nie',
            always: 'Immer',
            neverTitle: `${hostname} nie übersetzen`,
            alwaysTitle: `Immer aus ${source} übersetzen`,
            close: 'Schließen',
        }
    }

    if (targetLanguage === 'fr') {
        return {
            title: 'Traduire la page ?',
            context,
            translate: 'Traduire',
            never: 'Jamais',
            always: 'Toujours',
            neverTitle: `Ne jamais traduire ${hostname}`,
            alwaysTitle: `Toujours traduire depuis ${source}`,
            close: 'Fermer',
        }
    }

    return {
        title: 'Translate this page?',
        context,
        translate: 'Translate',
        never: 'Never',
        always: 'Always',
        neverTitle: `Never translate ${hostname}`,
        alwaysTitle: `Always translate from ${source}`,
        close: 'Close',
    }
}
