import { geminiProvider } from './providers/gemini.js'

const PROVIDERS = {
  gemini: geminiProvider,
}

export function getExtractionProvider(name) {
  const providerName = (name || process.env.EXTRACTION_PROVIDER || 'gemini').toLowerCase()
  const provider = PROVIDERS[providerName]
  if (!provider) {
    throw new Error(`Unknown extraction provider: ${providerName}`)
  }
  return provider
}

export async function runExtraction({ buffer, mimeType, fileName, providerName }) {
  const provider = getExtractionProvider(providerName)
  console.info(`[extraction] provider=${provider.name} file=${fileName || 'unknown'} mime=${mimeType || 'unknown'} bytes=${buffer?.length || 0}`)
  const result = await provider.extract({ buffer, mimeType, fileName })
  return result
}

export { geminiProvider }
