#!/usr/bin/env node
/**
 * Voice test: Gemini TTS speaks realistic Egyptian-Arabic notes, then the app's transcriber
 * turns them back into text. Checks that amounts and key words survive.
 *
 *   npm run voice:eval
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSpeech } from 'ai'
import { loadEnvFile } from './db-migrate.mjs'
import { getGoogle, MODELS } from '../api/_lib/agent/models.js'
import pg from 'pg'
import { connectionConfig } from './db-migrate.mjs'
import { transcribeAudio, loadNameHints } from '../api/agent/transcribe.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnvFile(path.join(root, '.env.local'))
if (process.env.GEMINI_API_KEY_PROMED) process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY_PROMED
const argv = process.argv.slice(2)
const useHints = !argv.includes('--no-hints')
const google = getGoogle()
const pgc = new pg.Client(connectionConfig())
await pgc.connect()
const names = await loadNameHints(async (fn, args) => (await pgc.query('select public.agent_ask_data($1) as v', [args.p_sql])).rows[0].v)
await pgc.end()
const outDir = path.join(root, 'test-results', 'voice')
fs.mkdirSync(outDir, { recursive: true })

const cases = [
  { say: 'دفعت تلتمية وخمسين جنيه بنزين للعربية النهارده', want: ['350', 'بنزين'] },
  { say: 'حولت اتناشر ألف جنيه إيجار المكتب', want: ['12000|12,000|12 ألف', 'إيجار|ايجار'] },
  { say: 'الريتاج دفع تلات تلاف كاش', want: ['3000|3,000', 'كاش', 'ريتاج'] },
  { say: 'صرفت ميتين أكل وألف وخمسمية للمخلص على شحنة الصين', want: ['200', '1500|1,500', 'شحن'] },
  { say: 'سجل فاتورة بيع اتنين جهاز ل مستشفى السلام بسعر خمستاشر ألف للواحد', want: ['15000|15,000|15 ألف', 'مستشفى'] },
  { say: 'paid two thousand five hundred for shipping on the office', want: ['2500|2,500', 'shipping'] },
]

let pass = 0
console.log(`TTS: gemini-3.8-flash-tts · transcriber: ${MODELS.transcribe}\n`)
for (const [i, c] of cases.entries()) {
  try {
    // Audio is generated once and reused, so runs are comparable.
    const file = path.join(outDir, `case${i + 1}.wav`)
    if (!fs.existsSync(file) || argv.includes('--fresh')) {
      const speech = await generateSpeech({ model: google.speech('gemini-3.8-flash-tts'), text: c.say, voice: i % 2 ? 'Charon' : 'Kore' })
      fs.writeFileSync(file, Buffer.from(speech.audio.uint8Array))
    }
    const bytes = fs.readFileSync(file)
    const started = Date.now()
    const { text, model } = await transcribeAudio(google, bytes, 'audio/wav', useHints ? names : [])
    const ms = Date.now() - started
    const missing = c.want.filter((w) => !new RegExp(w).test(text))
    if (missing.length) throw new Error(`missing ${missing.join(', ')} in "${text}"`)
    pass++
    console.log(`  ✓ ${String(ms).padStart(5)} ms ${model.padEnd(22)} ${text}`)
  } catch (e) {
    console.log(`  ✗ ${c.say}\n      ${e.message}`)
  }
}
console.log(`\n${pass}/${cases.length} voice notes transcribed correctly`)
process.exit(pass === cases.length ? 0 : 1)
