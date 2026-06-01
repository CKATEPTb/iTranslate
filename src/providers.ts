export const DEFAULT_PROVIDER = 'Google'

export const TRANSLATION_PROVIDERS = [
  'DeepL',
  'Google',
  'LibreTranslate',
  'Lingvanex',
  'Lara',
  'MyMemory',
  'OpenAI (Ollama)',
] as const

export type TranslationProvider = typeof TRANSLATION_PROVIDERS[number]

export type PageTranslationSupportStatus = 'available' | 'api-key-required' | 'unavailable'

export type PageTranslationSupport = {
  supported: boolean
  canEnable: boolean
  requiresApiKey: boolean
  status: PageTranslationSupportStatus
  requiredSetting?: string
}

const PAGE_TRANSLATION_ALWAYS_SUPPORTED = [
  'Google',
  'Lingvanex',
  'OpenAI (Ollama)',
] as const satisfies readonly TranslationProvider[]

const PAGE_TRANSLATION_REQUIRES_API_KEY: Partial<Record<TranslationProvider, string>> = {
  DeepL: 'deepl-key',
  LibreTranslate: 'libre-key',
}

function hasConfiguredValue(settings: Record<string, unknown>, key: string): boolean {
  const value = settings[key]
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

export function isKnownProvider(provider: unknown): provider is TranslationProvider {
  return typeof provider === 'string' && (TRANSLATION_PROVIDERS as readonly string[]).includes(provider)
}

export function normalizeProvider(provider: unknown): TranslationProvider {
  return isKnownProvider(provider) ? provider : DEFAULT_PROVIDER
}

export function getPageTranslationSupport(
  provider: unknown,
  settings: Record<string, unknown> = {}
): PageTranslationSupport {
  const normalized = normalizeProvider(provider)
  const requiredSetting = PAGE_TRANSLATION_REQUIRES_API_KEY[normalized]
  if (requiredSetting) {
    const supported = hasConfiguredValue(settings, requiredSetting)
    return {
      supported,
      canEnable: true,
      requiresApiKey: !supported,
      status: supported ? 'available' : 'api-key-required',
      requiredSetting,
    }
  }

  if ((PAGE_TRANSLATION_ALWAYS_SUPPORTED as readonly string[]).includes(normalized)) {
    return {
      supported: true,
      canEnable: true,
      requiresApiKey: false,
      status: 'available',
    }
  }

  return {
    supported: false,
    canEnable: false,
    requiresApiKey: false,
    status: 'unavailable',
  }
}

export function supportsPageTranslation(
  provider: unknown,
  settings: Record<string, unknown> = {}
): boolean {
  return getPageTranslationSupport(provider, settings).supported
}
