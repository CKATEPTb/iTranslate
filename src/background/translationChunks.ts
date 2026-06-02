const TRANSLATION_CHUNK_MAX_BYTES = 32 * 1024
const textEncoder = new TextEncoder()

function getUtf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength
}

function splitOversizedToken(token: string): string[] {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0

  for (const char of token) {
    const charBytes = getUtf8ByteLength(char)
    if (current && currentBytes + charBytes > TRANSLATION_CHUNK_MAX_BYTES) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }

    current += char
    currentBytes += charBytes
  }

  if (current) chunks.push(current)
  return chunks
}

export function splitTranslationText(text: string): string[] {
  if (getUtf8ByteLength(text) <= TRANSLATION_CHUNK_MAX_BYTES) return [text]

  const chunks: string[] = []
  const tokenPattern = /\s+|\S+/gu
  let current = ''
  let currentBytes = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(text))) {
    const token = match[0]
    const tokenBytes = getUtf8ByteLength(token)

    if (tokenBytes > TRANSLATION_CHUNK_MAX_BYTES) {
      if (current) {
        chunks.push(current)
        current = ''
        currentBytes = 0
      }
      chunks.push(...splitOversizedToken(token))
      continue
    }

    if (current && currentBytes + tokenBytes > TRANSLATION_CHUNK_MAX_BYTES) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }

    current += token
    currentBytes += tokenBytes
  }

  if (current) chunks.push(current)
  return chunks
}
