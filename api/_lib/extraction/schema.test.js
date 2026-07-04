import { describe, expect, it } from 'vitest'
import { parseJsonFromModel, validateExtractionResult } from './schema.js'

describe('parseJsonFromModel', () => {
  it('parses raw JSON', () => {
    const out = parseJsonFromModel('{"title":"License","confidence":0.9}')
    expect(out.title).toBe('License')
  })

  it('strips markdown fences', () => {
    const out = parseJsonFromModel('```json\n{"title":"A","confidence":0.5}\n```')
    expect(out.title).toBe('A')
  })
})

describe('validateExtractionResult', () => {
  it('normalizes fields for storage', () => {
    const out = validateExtractionResult({
      title: '  Cert  ',
      issue_date: '2024-01-15',
      confidence: 92,
      tags: ['fda'],
      products: [],
    })
    expect(out.title).toBe('Cert')
    expect(out.issue_date).toBe('2024-01-15')
    expect(out.confidence).toBe(0.92)
    expect(out.tags).toEqual(['fda'])
  })
})
