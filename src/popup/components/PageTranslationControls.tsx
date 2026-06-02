import type {JsxChild, JsxElement} from '#mini-jsx'
import type {PageTranslationSupport} from '../../providers.ts'

export type PageTranslationRuleAction = 'never' | 'always-from'

type PageTranslationSupportView = {
    badgeText: string
    statusText: string
    badgeClass: string
    dotClass: string
    statusClass: string
}

type PageTranslationRulesPanelProps = {
    hostname: string
    never: boolean
    alwaysFrom: string[]
    busy: boolean
    onClearRule: (action: PageTranslationRuleAction, language?: string) => void
}

type PageTranslationSupportBadgeProps = {
    support: PageTranslationSupport
}

type PageTranslationSupportTextProps = {
    support: PageTranslationSupport
}

type PageTranslationErrorProps = {
    error: string
}

const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    ru: 'Russian',
    ua: 'Ukrainian',
    uk: 'Ukrainian',
    de: 'German',
    fr: 'French',
}

const SPINNER_CLASS = 'inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent'
const REMOVE_RULE_BUTTON_CLASS = 'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-300 transition hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-slate-500/60'

function getLanguageName(language: string): string {
    return LANGUAGE_NAMES[language.toLowerCase()] ?? language.toUpperCase()
}

export function hasPageTranslationRules(hostname: string, never: boolean, alwaysFrom: string[]): boolean {
    return (hostname.length > 0 && never) || alwaysFrom.length > 0
}

function getPageTranslationSupportView(support: PageTranslationSupport): PageTranslationSupportView {
    if (support.supported) {
        return {
            badgeText: 'Page ready',
            statusText: support.requiredSetting
                ? 'Page translation uses this provider API key.'
                : 'Page translation is available for this provider.',
            badgeClass: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
            dotClass: 'bg-emerald-500',
            statusClass: 'text-emerald-600 dark:text-emerald-300',
        }
    }

    if (support.requiresApiKey) {
        return {
            badgeText: 'API key needed',
            statusText: 'Add an API key to enable page translation.',
            badgeClass: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
            dotClass: 'bg-amber-500',
            statusClass: 'text-amber-600 dark:text-amber-300',
        }
    }

    return {
        badgeText: 'Selection only',
        statusText: 'Page translation is unavailable for this provider.',
        badgeClass: 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400',
        dotClass: 'bg-slate-400',
        statusClass: 'text-slate-400 dark:text-slate-500',
    }
}

export function PageTranslationSupportBadge({support}: PageTranslationSupportBadgeProps): JsxElement {
    const view = getPageTranslationSupportView(support)

    return (
        <span
            class={`inline-flex max-w-[160px] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${view.badgeClass}`}
            title={view.statusText}
        >
            <span class={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${view.dotClass}`}></span>
            <span class="truncate">{view.badgeText}</span>
        </span>
    )
}

export function PageTranslationSupportText({support}: PageTranslationSupportTextProps): JsxElement {
    const view = getPageTranslationSupportView(support)

    return (
        <span class={`text-[11px] ${view.statusClass}`}>
            {view.statusText}
        </span>
    )
}

export function PageTranslationRulesPanel(props: PageTranslationRulesPanelProps): JsxElement {
    const canShowSiteRules = props.hostname.length > 0
    const hasLanguageRules = props.alwaysFrom.length > 0

    return (
        <section class="grid gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/70 p-3">
            <div class="flex items-center justify-between gap-2">
                <span class="text-slate-500 dark:text-slate-300">Page translation rules</span>
                {props.busy && <span class={SPINNER_CLASS}></span>}
            </div>
            {canShowSiteRules && (
                <div class="min-w-0 truncate text-[11px] text-slate-400 dark:text-slate-500">
                    Site: {props.hostname}
                </div>
            )}
            <div class="grid gap-2">
                <div class="grid gap-1">
                    <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        This site
                    </div>
                    {!canShowSiteRules && (
                        <RuleMessage>Site rules are unavailable on this page</RuleMessage>
                    )}
                    {canShowSiteRules && !props.never && (
                        <RuleMessage>No site rule</RuleMessage>
                    )}
                    {canShowSiteRules && props.never && (
                        <RuleItem
                            label="Never translate this site"
                            removeLabel="Remove never translate rule"
                            onRemove={() => props.onClearRule('never')}
                        />
                    )}
                </div>
                <div class="grid gap-1">
                    <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        All sites
                    </div>
                    {!hasLanguageRules && (
                        <RuleMessage>No language rules</RuleMessage>
                    )}
                    {props.alwaysFrom.map(language => {
                        const languageName = getLanguageName(language)
                        return (
                            <RuleItem
                                label={`Always translate from ${languageName}`}
                                removeLabel={`Remove always translate from ${languageName} rule`}
                                onRemove={() => props.onClearRule('always-from', language)}
                            />
                        )
                    })}
                </div>
            </div>
        </section>
    )
}

export function PageTranslationError({error}: PageTranslationErrorProps): JsxElement | null {
    if (!error) return null

    return (
        <p class="rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-[11px] text-red-600 dark:text-red-300">
            {error}
        </p>
    )
}

function RuleMessage({children}: {children?: JsxChild}): JsxElement {
    return (
        <div class="rounded-lg bg-white/70 dark:bg-slate-900/80 px-2 py-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {children}
        </div>
    )
}

function RuleItem({label, removeLabel, onRemove}: {label: string; removeLabel: string; onRemove: () => void}): JsxElement {
    return (
        <div class="flex items-center justify-between gap-2 rounded-lg bg-white/70 dark:bg-slate-900/80 px-2 py-1.5">
            <span class="min-w-0 truncate text-[11px] text-slate-600 dark:text-slate-300">
                {label}
            </span>
            <button
                type="button"
                onclick={onRemove}
                class={REMOVE_RULE_BUTTON_CLASS}
                title="Remove rule"
                aria-label={removeLabel}
            >
                x
            </button>
        </div>
    )
}
