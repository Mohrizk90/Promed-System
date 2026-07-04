import { describe, expect, it } from 'vitest'
import { toAdvancePayload } from './normalize.js'
import { validateExtractionResult } from './schema.js'

describe('toAdvancePayload', () => {
  it('maps extraction to advance_document_processing shape', () => {
    const extraction = validateExtractionResult({
      title: 'Import License',
      document_type: 'certificate',
      authority_name: 'MOH',
      summary: 'Short summary',
      extracted_text: 'Full OCR text',
      confidence: 0.88,
      extraction_confidence: 0.88,
      language: 'en',
      tags: ['license'],
      warnings: ['expiry unclear'],
    })

    const payload = toAdvancePayload(extraction)
    expect(payload.nextStatus).toBe('waiting_for_review')
    expect(payload.extractedText).toBe('Full OCR text')
    expect(payload.aiSummary).toBe('Short summary')
    expect(payload.documentType).toBe('certificate')
    expect(payload.confidenceScore).toBe(0.88)
    expect(payload.extractedMetadata.title).toBe('Import License')
    expect(payload.extractedMetadata.tags).toEqual(['license'])
    expect(payload.extractedMetadata.warnings).toEqual(['expiry unclear'])
  })
})
