import {DeepLTranslator} from './providers/DeepLTranslator.ts'
import {GoogleTranslator} from './providers/GoogleTranslator.ts'
import {LibreTranslateTranslator} from './providers/LibreTranslateTranslator.ts'
import {LingvanexTranslator} from './providers/LingvanexTranslator.ts'
import {LaraTranslator} from './providers/LaraTranslator.ts'
import {MyMemoryTranslator} from './providers/MyMemoryTranslator.ts'
import {OpenAITranslator} from './providers/OpenAITranslator.ts'
import type {Translator} from './types.ts'

export function getTranslator(provider: string): Translator {
  switch (provider) {
    case 'DeepL':
      return new DeepLTranslator()
    case 'Google':
      return new GoogleTranslator()
    case 'LibreTranslate':
      return new LibreTranslateTranslator()
    case 'Lingvanex':
      return new LingvanexTranslator()
    case 'Lara':
      return new LaraTranslator()
    case 'MyMemory':
      return new MyMemoryTranslator()
    case 'OpenAI (Ollama)':
      return new OpenAITranslator()
    default:
      return new MyMemoryTranslator()
  }
}
