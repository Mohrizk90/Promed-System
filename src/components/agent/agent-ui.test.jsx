import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import MiniMarkdown from './MiniMarkdown'
import { encodeWav } from '../../lib/audioRecorder'
import { translations } from '../../translations'

describe('MiniMarkdown', () => {
  it('renders bold, lists and links without raw HTML', () => {
    const { container } = render(<MiniMarkdown text={'**Total** 500\n- one\n- two\n[open](/money)\n<script>x</script>'} />)
    expect(screen.getByText('Total').tagName).toBe('STRONG')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByText('open').getAttribute('href')).toBe('/money')
    expect(container.querySelector('script')).toBeNull()
  })
  it('does not turn javascript: urls into links', () => {
    const { container } = render(<MiniMarkdown text={'[x](javascript:alert(1))'} />)
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit WAV header', async () => {
    const blob = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000)
    const ab = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsArrayBuffer(blob) })
    const buf = new DataView(ab)
    const str = (o) => String.fromCharCode(...[0, 1, 2, 3].map((i) => buf.getUint8(o + i)))
    expect(str(0)).toBe('RIFF')
    expect(str(8)).toBe('WAVE')
    expect(buf.getUint32(24, true)).toBe(16000)
    expect(buf.getUint16(22, true)).toBe(1)
    expect(buf.getUint32(40, true)).toBe(8)
    expect(buf.byteLength).toBe(44 + 8)
    expect(buf.getInt16(46, true)).toBe(Math.floor(0.5 * 0x7fff))
  })
})

// Every agent.* key the UI uses exists in English and Arabic.
describe('agent translations', () => {
  const dir = join(process.cwd(), 'src')
  const files = ['components/agent', 'components/projects', 'components/money']
    .flatMap((d) => readdirSync(join(dir, d)).filter((f) => f.endsWith('.jsx') && !f.includes('.test.')).map((f) => join(dir, d, f)))
  const source = files.map((f) => readFileSync(f, 'utf8')).join('\n')
  const keys = [...new Set([...source.matchAll(/t\('((?:agent|projects|money|activity|nav)\.[a-z_]+)'/g)].map((m) => m[1]))]
  const get = (lang, key) => key.split('.').reduce((o, k) => o?.[k], translations[lang])

  it('finds the keys', () => { expect(keys.length).toBeGreaterThan(80) })
  for (const lang of ['en', 'ar']) {
    it(`${lang} has every key`, () => {
      const missing = keys.filter((k) => typeof get(lang, k) !== 'string')
      expect(missing).toEqual([])
    })
  }
  it('en and ar have the same agent keys', () => {
    expect(Object.keys(translations.ar.agent).sort()).toEqual(Object.keys(translations.en.agent).sort())
    expect(Object.keys(translations.ar.projects).sort()).toEqual(Object.keys(translations.en.projects).sort())
    expect(Object.keys(translations.ar.money).sort()).toEqual(Object.keys(translations.en.money).sort())
  })
  it('has a status label for every action status and a label for every agent tool', () => {
    for (const s of ['saved', 'applied', 'pending', 'undone', 'cancelled', 'failed', 'error']) expect(get('ar', `agent.status_${s}`)).toBeTruthy()
    const tools = readFileSync(join(process.cwd(), 'api/_lib/agent/tools.js'), 'utf8')
    const names = [...tools.matchAll(/^ {4}([a-z_]+): tool\(/gm)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(25)
    expect(names.filter((n) => !get('ar', `agent.tool_${n}`))).toEqual([])
  })
})

describe('agentErrorText', () => {
  it('turns server codes into the owner language', async () => {
    const { agentErrorText } = await import('../../lib/agentApi')
    const t = (k) => `T:${k}`
    expect(agentErrorText(new Error('AGENT_ERROR:key_invalid'), t)).toBe('T:agent.err_key_invalid')
    expect(agentErrorText(new Error('{"error":"API key not valid","code":"key_invalid"}'), t)).toBe('T:agent.err_key_invalid')
    expect(agentErrorText(Object.assign(new Error('x'), { code: 'quota' }), t)).toBe('T:agent.err_quota')
    expect(agentErrorText(new TypeError('Failed to fetch'), t)).toBe('T:agent.err_network')
    expect(agentErrorText(new Error('AGENT_ERROR:generic'), t)).toBe('T:agent.err_generic')
    expect(agentErrorText(new Error('Recording was too short'), t)).toBe('Recording was too short')
  })
})

describe('storageSafeName', () => {
  it('keeps storage keys plain ASCII (Supabase rejects Arabic)', async () => {
    const { storageSafeName } = await import('../../lib/agentApi')
    expect(storageSafeName('مخزن بروميد ptl.pdf')).toBe('ptl.pdf')
    expect(storageSafeName('فاتورة.PDF')).toBe('file.pdf')
    expect(storageSafeName('scan 2026 (1).jpg')).toBe('scan_2026_1.jpg')
    expect(storageSafeName('noext')).toBe('noext')
    for (const n of ['مخزن بروميد ptl.pdf', 'إيصال ١٢.png', 'a b.c.d.docx']) expect(storageSafeName(n)).toMatch(/^[A-Za-z0-9_.-]+$/)
  })
})
