import {read} from '../store.ts'
import {getTranslator} from './translator'

type TranslateMode = 'selection' | 'input'

type TranslateRequestMessage = {
  type: 'TRANSLATE_TEXT'
  text: string
  mode: TranslateMode
}

async function translateText(request: TranslateRequestMessage): Promise<string> {
  const settings = await read()
  const source = request.mode === 'selection' ? settings.translate_select_from : settings.translate_input_from
  const target = request.mode === 'selection' ? settings.translate_select_to : settings.translate_input_to

  return getTranslator(settings.provider).translate({
    text: request.text,
    from: source,
    to: target,
    settings
  })
}

// message handler
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    sendResponse({ok: false, error: 'Invalid request'})
    return
  }

  const typed = message as Partial<TranslateRequestMessage>
  if (typed.type !== 'TRANSLATE_TEXT' || typeof typed.text !== 'string') {
    sendResponse({ok: false, error: 'Invalid request'})
    return
  }

  translateText(typed as TranslateRequestMessage)
      .then((translatedText) => sendResponse({ok: true, translatedText}))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : 'Unknown translation error'
        sendResponse({ok: false, error: messageText})
      })

  return true
})

// command handler
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'translate-focused-input') {
    return
  }

  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tabId = tabs[0]?.id
    if (!tabId) {
      return
    }
    void chrome.tabs.sendMessage(tabId, {type: 'APPLY_TRANSFORM_TO_FOCUS'})
  })
})
