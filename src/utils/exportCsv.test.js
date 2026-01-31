import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadCsv } from './exportCsv'

describe('exportCsv', () => {
  let createObjectURLSpy
  let revokeObjectURLSpy

  beforeEach(() => {
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns early when rows is null or undefined', () => {
    downloadCsv('test.csv', null)
    downloadCsv('test.csv', undefined)
    expect(createObjectURLSpy).not.toHaveBeenCalled()
  })

  it('returns early when rows is empty array', () => {
    downloadCsv('test.csv', [])
    expect(createObjectURLSpy).not.toHaveBeenCalled()
  })

  it('creates blob and triggers download with valid rows', () => {
    const rows = [
      { name: 'John', amount: 100 },
      { name: 'Jane', amount: 200 }
    ]
    downloadCsv('export.csv', rows)

    expect(createObjectURLSpy).toHaveBeenCalled()
    const blob = createObjectURLSpy.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toContain('text/csv')
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
  })

  it('creates CSV blob with correct type', () => {
    const rows = [{ col: 'test' }]
    downloadCsv('test.csv', rows)

    const blob = createObjectURLSpy.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toContain('text/csv')
    expect(blob.type).toContain('utf-8')
  })
})
