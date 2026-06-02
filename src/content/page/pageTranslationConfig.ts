import {PAGE_TRANSLATION_STATUS_CLASS} from './pageTranslationStatus'
import {PAGE_TRANSLATION_PROMPT_ID} from './pageTranslationPrompt'

export const TOOLTIP_ID = 'itranslate-tooltip'
export const STATUS_ID = 'itranslate-status'
export const PAGE_TRANSLATION_TABS_KEY = 'itranslate-page-translation-tabs'

export const PAGE_TRANSLATION_CONCURRENCY = 3
export const PAGE_TRANSLATION_MUTATION_RESCAN_DELAY_MS = 350
export const PAGE_TRANSLATION_ACTIVE_RESCAN_INTERVAL_MS = 2200
export const PAGE_TRANSLATION_ACTIVE_RESCAN_MAX_INTERVAL_MS = 6000
export const PAGE_TRANSLATION_ACTIVE_RESCAN_RECENT_COLLECT_MS = 1200

export const PAGE_TRANSLATION_SUGGESTION_THRESHOLD = 0.05
export const PAGE_TRANSLATION_SUGGESTION_MAX_NODES = 140
export const PAGE_TRANSLATION_SUGGESTION_MAX_VISIBLE_TEXT_NODES = 800
export const PAGE_TRANSLATION_SUGGESTION_MAX_SCANNED_TEXT_NODES = 5000
export const PAGE_TRANSLATION_SUGGESTION_MAX_CHARS = 9000
export const PAGE_TRANSLATION_FAST_SUGGESTION_MIN_LETTERS = 80
export const PAGE_TRANSLATION_FAST_SUGGESTION_MAX_SCANNED_TEXT_NODES = 800
export const PAGE_TRANSLATION_FAST_SUGGESTION_MAX_VISIBLE_TEXT_NODES = 80
export const PAGE_TRANSLATION_FAST_SUGGESTION_MAX_CHARS = 2200

export const PAGE_TRANSLATION_SKIP_SELECTOR = [
    `#${TOOLTIP_ID}`,
    `#${STATUS_ID}`,
    `#${PAGE_TRANSLATION_PROMPT_ID}`,
    `.${PAGE_TRANSLATION_STATUS_CLASS}`,
    'script',
    'style',
    'noscript',
    'textarea',
    'code',
    'pre',
    'kbd',
    'samp',
    'svg',
    'math',
    'canvas',
    '[aria-hidden="true"]',
].join(',')

export const PAGE_TRANSLATION_PLACEHOLDER_SKIP_SELECTOR = [
    `#${TOOLTIP_ID}`,
    `#${STATUS_ID}`,
    `#${PAGE_TRANSLATION_PROMPT_ID}`,
    `.${PAGE_TRANSLATION_STATUS_CLASS}`,
    'script',
    'style',
    'noscript',
    'code',
    'pre',
    'kbd',
    'samp',
    'svg',
    'math',
    'canvas',
    '[aria-hidden="true"]',
].join(',')
