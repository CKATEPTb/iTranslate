import type {TranslateContext, Translator} from '../types.ts'
import {mapLanguageCode} from '../language.ts'
import {FreeDeepLTranslator} from "./FreeDeepLTranslator.ts";

export class DeepLTranslator implements Translator {
    async translate(context: TranslateContext): Promise<string> {
        if (!context.settings['deepl-key']) {
            const translator = new FreeDeepLTranslator();
            const result = await translator.translate({
                text: context.text,
                from: context.from === 'auto' ? '' : mapLanguageCode(context.from).toLowerCase(),
                to: mapLanguageCode(context.to).toLowerCase()
            });

            await translator.close();
            return result
        }

        const body = new URLSearchParams()
        body.set('text', context.text)
        body.set('target_lang', mapLanguageCode(context.to).toUpperCase())
        if (context.from !== 'auto') {
            body.set('source_lang', mapLanguageCode(context.from).toUpperCase())
        }

        const response = await fetch('https://api-free.deepl.com/v2/translate', {
            method: 'POST',
            headers: {
                Authorization: `DeepL-Auth-Key ${context.settings['deepl-key']}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
        })

        if (!response.ok) {
            throw new Error(`DeepL failed: ${response.status}`)
        }

        const result = (await response.json()) as { translations?: Array<{ text?: string }> }
        const translatedText = result.translations?.[0]?.text?.trim()
        if (!translatedText) {
            throw new Error('DeepL returned empty translation')
        }
        return translatedText
    }
}
