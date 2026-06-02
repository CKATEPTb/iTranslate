import type {SendResponse} from './runtimeMessages.ts'

export function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise(resolve => {
    try {
      chrome.tabs.query({active: true, currentWindow: true}, tabs => {
        void chrome.runtime.lastError
        resolve(tabs[0])
      })
    } catch {
      resolve(undefined)
    }
  })
}

export function canTranslateTab(tab: chrome.tabs.Tab): boolean {
  const url = tab.url ?? ''
  return /^(https?:|file:)/i.test(url)
}

export function sendTabMessage(tabId: number, message: unknown): Promise<boolean> {
  return new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        const error = chrome.runtime.lastError
        resolve(!error)
      })
    } catch {
      resolve(false)
    }
  })
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function sendErrorResponse(sendResponse: SendResponse, error: unknown, fallback: string): void {
  sendResponse({ok: false, error: getErrorMessage(error, fallback)})
}

export function sendPromiseResponse<T>(
  sendResponse: SendResponse,
  promise: Promise<T>,
  mapResult: (result: T) => unknown,
  errorFallback: string,
): true {
  promise
    .then((result) => sendResponse(mapResult(result)))
    .catch((error: unknown) => sendErrorResponse(sendResponse, error, errorFallback))
  return true
}
