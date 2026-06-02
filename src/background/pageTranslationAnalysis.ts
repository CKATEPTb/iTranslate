import {detectTextLanguage, isTextLikelyLanguage, type DetectableLanguage} from '../languageDetection.ts'
import {getLanguageSampleWeight, normalizeDetectableLanguage} from './detectableLanguage.ts'
import type {PageTranslationAnalyzeSamplesMessage} from './runtimeMessages.ts'

const PAGE_TRANSLATION_ANALYSIS_MIN_WEIGHT = 160

export function analyzePageTranslationSamples(request: PageTranslationAnalyzeSamplesMessage) {
  const targetLanguage = normalizeDetectableLanguage(request.target)
  if (!targetLanguage) return null

  const sourceWeights: Partial<Record<DetectableLanguage, number>> = {}
  const documentLanguage = normalizeDetectableLanguage(request.documentLanguage ?? '')
  let visibleWeight = 0
  let targetWeight = 0
  let totalWeight = 0
  let mismatchWeight = 0

  for (const sample of request.samples) {
    if (typeof sample !== 'string') continue

    const weight = getLanguageSampleWeight(sample)
    if (weight <= 0) continue

    visibleWeight += weight
    const isTargetLikely = isTextLikelyLanguage(sample, targetLanguage)
    if (isTargetLikely) targetWeight += weight

    const detected = detectTextLanguage(sample)
    if (!detected) continue

    totalWeight += weight

    const isTarget = detected === targetLanguage || isTargetLikely
    if (isTarget) continue

    mismatchWeight += weight
    sourceWeights[detected] = (sourceWeights[detected] ?? 0) + weight
  }

  if (totalWeight < PAGE_TRANSLATION_ANALYSIS_MIN_WEIGHT || mismatchWeight === 0) {
    const fallbackMismatchWeight = visibleWeight - targetWeight
    if (
      documentLanguage &&
      documentLanguage !== targetLanguage &&
      visibleWeight >= PAGE_TRANSLATION_ANALYSIS_MIN_WEIGHT &&
      fallbackMismatchWeight / visibleWeight >= 0.05
    ) {
      return {
        sourceLanguage: documentLanguage,
        mismatchRatio: fallbackMismatchWeight / visibleWeight,
        totalWeight: visibleWeight,
        mismatchWeight: fallbackMismatchWeight,
      }
    }

    return null
  }

  const sourceLanguage = (Object.entries(sourceWeights) as Array<[DetectableLanguage, number]>)
    .sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!sourceLanguage || sourceLanguage === targetLanguage) return null

  return {
    sourceLanguage,
    mismatchRatio: mismatchWeight / totalWeight,
    totalWeight,
    mismatchWeight,
  }
}
