import { describe, it, expect, vi } from 'vitest'
import { amountOf, decideAutoSave } from './policy.js'
import { prepareUiMessages } from './run.js'
import { createTools, PAGES } from './tools.js'
import { speakableText } from '../../agent/speak.js'

describe('smart confirm policy', () => {
  it('auto-saves a clear new entry under the limit', () => {
    const r = decideAutoSave({ kind: 'record_entries', payload: {}, amount: 450, confident: true, limit: 5000 })
    expect(r.save).toBe(true)
  })
  it('waits at or above the limit', () => {
    expect(decideAutoSave({ kind: 'record_entries', payload: {}, amount: 5000, limit: 5000 }).save).toBe(false)
    expect(decideAutoSave({ kind: 'client_payment', payload: {}, amount: 12000, limit: 5000 }).save).toBe(false)
  })
  it('always waits for edits, deletes and unlinks, whatever the amount', () => {
    for (const kind of ['update_record', 'delete_record', 'unlink_records']) {
      expect(decideAutoSave({ kind, payload: {}, amount: 1 }).save).toBe(false)
    }
  })
  it('waits for a batch that hides an edit', () => {
    const payload = { operations: [{ kind: 'record_entries', payload: {} }, { kind: 'update_record', payload: {} }] }
    expect(decideAutoSave({ kind: 'batch', payload, amount: 10 }).save).toBe(false)
  })
  it('waits when the agent guessed', () => {
    expect(decideAutoSave({ kind: 'record_entries', payload: {}, amount: 10, confident: false }).save).toBe(false)
  })
  it('limit 0 means always ask; missing limit uses the 5,000 default', () => {
    expect(decideAutoSave({ kind: 'record_entries', payload: {}, amount: 1, limit: 0 }).save).toBe(false)
    expect(decideAutoSave({ kind: 'record_entries', payload: {}, amount: 4999, limit: null }).save).toBe(true)
    expect(decideAutoSave({ kind: 'record_entries', payload: {}, amount: 5001, limit: undefined }).save).toBe(false)
  })
  it('measures amounts per kind', () => {
    expect(amountOf('record_entries', { entries: [{ amount: 200 }, { amount: '300' }] })).toBe(500)
    expect(amountOf('record_sale', { lines: [{ quantity: 2, unit_price: 100 }] })).toBe(200)
    expect(amountOf('record_sale', { lines: [] }, { total: 3955 })).toBe(3955)
    expect(amountOf('batch', { operations: [{ kind: 'client_payment', payload: { amount: 100 } }, { kind: 'record_entries', payload: { entries: [{ amount: 50 }] } }] })).toBe(150)
  })
})

describe('prepareUiMessages', () => {
  it('keeps file bytes only for the newest user message', () => {
    const msgs = [
      { id: '1', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'https://old', filename: 'old.png' }, { type: 'text', text: 'a' }] },
      { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
      { id: '3', role: 'user', parts: [{ type: 'file', mediaType: 'application/pdf', url: 'https://new', filename: 'new.pdf' }] },
    ]
    const out = prepareUiMessages(msgs)
    expect(out[0].parts[0]).toEqual({ type: 'text', text: '[Attached file: old.png]' })
    expect(out[2].parts[0].type).toBe('file')
  })
  it('replaces unreadable file types with a note', () => {
    const out = prepareUiMessages([{ id: '1', role: 'user', parts: [{ type: 'file', mediaType: 'application/zip', filename: 'x.zip' }] }])
    expect(out[0].parts[0].type).toBe('text')
  })
  it('keeps only the last 40 messages', () => {
    const msgs = Array.from({ length: 55 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', parts: [] }))
    const out = prepareUiMessages(msgs)
    expect(out).toHaveLength(40)
    expect(out[0].id).toBe('15')
  })
})

function fakeDb({ dryOk = true, commitFails = false } = {}) {
  const calls = []
  return {
    calls,
    rpc: vi.fn(async (fn, args) => {
      calls.push(fn)
      if (fn === 'agent_dry_run') return dryOk ? { ok: true, result: { ids: [1] } } : { ok: false, error: 'Share over 100%' }
      if (fn === 'agent_stage') return 'action-1'
      if (fn === 'agent_commit') { if (commitFails) throw new Error('boom'); return { ok: true } }
      if (fn === 'agent_ask_data') return []
      return null
    }),
  }
}
const opts = { toolCallId: 't1', messages: [] }
const entry = (amount) => ({ entries: [{ kind: 'expense', amount, category_id: 1 }], summary: 'Fuel', confident: true })

describe('agent write path', () => {
  it('dry-runs, stages and commits a small clear entry', async () => {
    const db = fakeDb()
    const tools = createTools({ db, settings: { auto_save_limit: 5000 }, lists: { categories: [{ id: 1, name_en: 'Fuel', name_ar: 'بنزين' }] } })
    const out = await tools.record_money.execute(entry(300), opts)
    expect(out.status).toBe('saved')
    expect(db.calls).toEqual(expect.arrayContaining(['agent_dry_run', 'agent_stage', 'agent_commit']))
    expect(db.calls.indexOf('agent_dry_run')).toBeLessThan(db.calls.indexOf('agent_stage'))
  })
  it('stages but does not commit a large entry', async () => {
    const db = fakeDb()
    const tools = createTools({ db, settings: { auto_save_limit: 5000 }, lists: {} })
    const out = await tools.record_money.execute(entry(9000), opts)
    expect(out.status).toBe('pending')
    expect(out.action_id).toBe('action-1')
    expect(db.calls).not.toContain('agent_commit')
  })
  it('stages nothing when the dry run fails', async () => {
    const db = fakeDb({ dryOk: false })
    const tools = createTools({ db, settings: {}, lists: {} })
    const out = await tools.record_money.execute(entry(10), opts)
    expect(out.status).toBe('error')
    expect(out.error).toMatch(/Share/)
    expect(db.calls).not.toContain('agent_stage')
  })
  it('marks the action failed when commit throws', async () => {
    const db = fakeDb({ commitFails: true })
    const tools = createTools({ db, settings: {}, lists: {} })
    const out = await tools.record_money.execute(entry(10), opts)
    expect(out.status).toBe('error')
    expect(db.calls).toContain('agent_mark_failed')
  })
  it('open_page resolves ids and refuses a missing one', async () => {
    const tools = createTools({ db: fakeDb(), settings: {}, lists: {} })
    expect(await tools.open_page.execute({ page: 'project', id: 7 }, opts)).toEqual({ navigate: '/projects/7' })
    expect((await tools.open_page.execute({ page: 'project' }, opts)).error).toBeTruthy()
    expect(PAGES.money).toBe('/money')
  })
})

describe('speakableText', () => {
  it('drops markdown and code and keeps link labels', () => {
    expect(speakableText('**Saved** [fuel](/money)\n```sql\nselect 1\n```')).toBe('Saved fuel')
  })
  it('caps the length', () => {
    expect(speakableText('a'.repeat(2000))).toHaveLength(700)
  })
})

describe('aiErrorCode', () => {
  it('names Gemini key, quota and model failures', async () => {
    const { aiErrorCode, streamErrorText } = await import('./errors.js')
    expect(aiErrorCode({ statusCode: 400, message: 'API key not valid. Please pass a valid API key.' })).toBe('key_invalid')
    expect(aiErrorCode({ message: 'API key expired. Please renew the API key.' })).toBe('key_invalid')
    expect(aiErrorCode(new Error('GEMINI_API_KEY is not set on the server'))).toBe('key_missing')
    expect(aiErrorCode({ statusCode: 403, message: 'Requests from this API are blocked' })).toBe('key_blocked')
    expect(aiErrorCode({ statusCode: 429, message: 'Resource has been exhausted (e.g. check quota).' })).toBe('quota')
    expect(aiErrorCode({ message: 'Failed after 2 attempts', lastError: { statusCode: 503, message: 'The model is overloaded' } })).toBe('busy')
    expect(aiErrorCode({ statusCode: 404, message: 'models/x is not found for API version v1beta' })).toBe('model')
    expect(aiErrorCode(new TypeError('fetch failed'))).toBe('network')
    expect(aiErrorCode(new Error('column "x" does not exist'))).toBe(null)
    expect(streamErrorText(new Error('weird'))).toBe('AGENT_ERROR:generic')
  })
})
