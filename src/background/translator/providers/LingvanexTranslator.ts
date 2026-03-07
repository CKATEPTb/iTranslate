import type {TranslateContext, Translator} from '../types.ts'
import {mapLanguageCode} from '../language.ts'

export class LingvanexTranslator implements Translator {
    async translate(context: TranslateContext): Promise<string> {
        let url = 'https://api-b2b.backenster.com/b1/api/v3/translate'
        let auth = context.settings['lingvanex-key']
        let platform = 'api'
        if (!auth) {
            url = 'https://backenster.com/v2/api/v3/translate'
            auth = 'Fujiwaranosai'
            platform = 'browserExtension'
        }
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: auth,
                'Content-Type': 'application/json; charset=UTF-8'
            },
            body: JSON.stringify({
                from: mapLanguageCode(context.from),
                to: mapLanguageCode(context.to),
                data: context.text,
                platform: platform
            })
        })

        if (!response.ok) {
            throw new Error(`Lingvanex failed: ${response.status}`)
        }

        const result = (await response.json()) as { result?: string }
        const translatedText = result.result?.trim()
        if (!translatedText) {
            throw new Error('Lingvanex returned empty translation')
        }
        return translatedText
    }
}


export class VivaldiTranslator extends LingvanexTranslator {
    async translate(context: TranslateContext): Promise<string> {
        return super.translate(context);
    }
}