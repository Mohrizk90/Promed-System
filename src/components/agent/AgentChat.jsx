import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useLocation, useNavigate } from 'react-router-dom'
import { Mic, Square, Send, Paperclip, X, Loader2, AlertTriangle, FileText, Image as ImageIcon, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { AGENT_CHAT_URL, agentErrorText, getAccessToken, notifyDataChanged, speak, transcribe, uploadAttachment } from '../../lib/agentApi'
import { canRecord, startRecording } from '../../lib/audioRecorder'
import MiniMarkdown from './MiniMarkdown'
import { ActionCard, ActionStatusContext, ChartCard, ComplianceCard, SourcesCard, TableCard, ToolChip } from './AgentCards'

const WRITE_TOOLS = new Set(['record_money', 'receive_client_payment', 'pay_supplier', 'record_sale', 'record_purchase', 'create_project',
  'create_project_type', 'link_to_project', 'create_record', 'update_record', 'delete_record'])

const SUGGESTIONS = {
  ar: ['دفعت 350 بنزين للعربية', 'مين أكتر عميل عليه فلوس؟', 'مصاريف الشهر ده متقسمة على التصنيفات', 'إيه الرخص اللي هتخلص قريب؟'],
  en: ['Paid 350 fuel for the car', 'Who owes us the most?', "This month's expenses by category", 'Which licences expire soon?'],
}

function useActionStatuses(messages) {
  const [statuses, setStatuses] = useState({})
  const ids = useMemo(() => {
    const out = []
    for (const m of messages) for (const p of m.parts || []) if (p.output?.action_id) out.push(p.output.action_id)
    return out
  }, [messages])
  const key = ids.join(',')
  useEffect(() => {
    if (!ids.length) return
    let alive = true
    supabase.from('agent_actions').select('id, status').in('id', ids).then(({ data }) => {
      if (alive && data) setStatuses((s) => ({ ...s, ...Object.fromEntries(data.map((a) => [a.id, a.status])) }))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const setStatus = useCallback((id, status) => setStatuses((s) => ({ ...s, [id]: status })), [])
  return { statuses, setStatus }
}

function MessageParts({ message, t, language, freshIds }) {
  const parts = message.parts || []
  const chips = []
  const blocks = []
  parts.forEach((p, i) => {
    if (p.type === 'text' && p.text?.trim()) {
      blocks.push(<MiniMarkdown key={`t${i}`} text={p.text} />)
      return
    }
    if (!p.type?.startsWith('tool-')) return
    const name = p.type.slice(5)
    const fresh = freshIds.has(p.toolCallId)
    const out = p.output
    if (p.state === 'output-error') {
      chips.push(<ToolChip key={`c${i}`} name={name} state={p.state} t={t} />)
      return
    }
    if (p.state !== 'output-available') {
      chips.push(<ToolChip key={`c${i}`} name={name} state={p.state} t={t} />)
      return
    }
    if (WRITE_TOOLS.has(name) && out?.status) blocks.push(<ActionCard key={`a${i}`} output={out} t={t} language={language} />)
    else if (name === 'show_table') blocks.push(<TableCard key={`tb${i}`} output={out} t={t} fresh={fresh} />)
    else if (name === 'show_chart') blocks.push(<ChartCard key={`ch${i}`} output={out} />)
    else if (name === 'file_legal_document' || name === 'scan_compliance_document') blocks.push(<ComplianceCard key={`cp${i}`} output={out} t={t} />)
    else if (name === 'web_search') { chips.push(<ToolChip key={`c${i}`} name={name} state={p.state} t={t} />); blocks.push(<SourcesCard key={`s${i}`} output={out} />) }
    else chips.push(<ToolChip key={`c${i}`} name={name} state={p.state} t={t} />)
  })
  return (
    <div className="space-y-2">
      {chips.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>}
      {blocks}
    </div>
  )
}

export default function AgentChat({ conversationId, initialMessages, user, t, language, voiceReplies, onActivity }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [rec, setRec] = useState(null)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [localError, setLocalError] = useState(null)
  const scrollRef = useRef(null)
  const fileRef = useRef(null)
  const freshIds = useRef(new Set())
  const handled = useRef(new Set())
  const lastVoice = useRef(false)
  const pageRef = useRef(location.pathname)
  pageRef.current = location.pathname

  const transport = useMemo(() => new DefaultChatTransport({
    api: AGENT_CHAT_URL,
    headers: async () => ({ Authorization: `Bearer ${await getAccessToken()}` }),
    body: () => ({ page: pageRef.current, locale: language }),
  }), [language])

  const { messages, sendMessage, status, stop, error, regenerate, clearError } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: async ({ message }) => {
      onActivity?.()
      if (!voiceReplies || !lastVoice.current) return
      const text = (message.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ')
      if (!text.trim()) return
      try {
        const blob = await speak(text)
        const audio = new Audio(URL.createObjectURL(blob))
        audio.play().catch(() => {})
      } catch { /* speaking is optional */ }
    },
  })

  // Parts that existed before this chat was opened are history: never re-run their side effects.
  useEffect(() => {
    for (const m of initialMessages || []) for (const p of m.parts || []) if (p.toolCallId) handled.current.add(p.toolCallId)
  }, [initialMessages])

  // Side effects of fresh tool results: open pages, refresh screens.
  useEffect(() => {
    let changed = false
    for (const m of messages) {
      for (const p of m.parts || []) {
        if (!p.toolCallId || p.state !== 'output-available' || handled.current.has(p.toolCallId)) continue
        handled.current.add(p.toolCallId)
        freshIds.current.add(p.toolCallId)
        const name = p.type.slice(5)
        if (name === 'open_page' && p.output?.navigate) navigate(p.output.navigate)
        if (p.output?.status === 'saved' || name === 'undo_action' || name === 'file_legal_document') changed = true
      }
    }
    if (changed) notifyDataChanged({ source: 'agent' })
  }, [messages, navigate])

  const statusCtx = useActionStatuses(messages)
  const busy = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, status, transcribing])

  useEffect(() => {
    if (!rec) return undefined
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - rec.startedAt) / 1000)), 250)
    return () => clearInterval(id)
  }, [rec])

  const send = async (text, { voice = false } = {}) => {
    const clean = (text || '').trim()
    if ((!clean && !files.length) || busy) return
    setLocalError(null)
    lastVoice.current = voice
    let uploaded = []
    if (files.length) {
      setUploading(true)
      try {
        uploaded = await Promise.all(files.map((f) => uploadAttachment(f, user.id)))
      } catch (e) {
        setLocalError(agentErrorText(e, t))
        setUploading(false)
        return
      }
      setUploading(false)
    }
    setInput('')
    setFiles([])
    await sendMessage(
      {
        text: clean || t('agent.see_attached'),
        files: uploaded.map((u) => ({ type: 'file', mediaType: u.mime, url: u.url, filename: u.name })),
        metadata: {
          voice,
          attachments: uploaded.map((u) => ({ path: u.path, file_name: u.name, mime_type: u.mime, size_bytes: u.size })),
        },
      },
      { body: { voiceText: voice ? clean : undefined } },
    )
  }

  const toggleRecord = async () => {
    if (rec) {
      const r = rec
      setRec(null)
      setLevel(0)
      setTranscribing(true)
      try {
        const { base64, mediaType, seconds } = await r.stop()
        if (seconds < 0.6) throw new Error(t('agent.too_short'))
        const { text } = await transcribe(base64, mediaType)
        if (!text?.trim()) throw new Error(t('agent.no_speech'))
        await send(text, { voice: true })
      } catch (e) {
        setLocalError(agentErrorText(e, t))
      } finally {
        setTranscribing(false)
      }
      return
    }
    setLocalError(null)
    try {
      const r = await startRecording({ onLevel: setLevel })
      setElapsed(0)
      setRec(r)
    } catch (e) {
      setLocalError(e?.name === 'NotAllowedError' ? t('agent.mic_denied') : agentErrorText(e, t))
    }
  }

  const cancelRecord = () => {
    rec?.cancel()
    setRec(null)
    setLevel(0)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(input)
    }
  }

  const empty = messages.length === 0
  const suggestions = SUGGESTIONS[language === 'ar' ? 'ar' : 'en']

  return (
    <ActionStatusContext.Provider value={statusCtx}>
      <div className="flex flex-col h-full min-h-0">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 space-y-3">
          {empty && (
            <div className="pt-6 pb-2 text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-[0_14px_30px_-14px_rgba(79,70,229,0.9)]">
                <Mic size={26} />
              </div>
              <h3 className="mt-3 text-[17px] font-semibold text-[#0b2a55]">{t('agent.hello')}</h3>
              <p className="mt-1 text-[13px] text-slate-500 max-w-[300px] mx-auto">{t('agent.hello_sub')}</p>
              <div className="mt-4 flex flex-col gap-2 items-stretch max-w-[320px] mx-auto">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)}
                    className="text-start rounded-2xl bg-white/75 ring-1 ring-white px-3.5 py-2.5 text-[13px] text-slate-700 shadow-sm hover:bg-white active:scale-[0.99]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'user' ? (
                <div className="max-w-[85%] rounded-[20px] rounded-ee-md bg-gradient-to-b from-blue-600 to-blue-700 text-white px-3.5 py-2 text-[14px] shadow-[0_10px_22px_-14px_rgba(29,78,216,0.9)]">
                  {m.metadata?.voice && <div className="flex items-center gap-1 text-[10.5px] text-blue-100 mb-0.5"><Mic size={11} />{t('agent.voice_note')}</div>}
                  {(m.parts || []).filter((p) => p.type === 'file').map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[12px] text-blue-50 bg-white/15 rounded-lg px-2 py-1 mb-1">
                      {p.mediaType?.startsWith('image/') ? <ImageIcon size={13} /> : <FileText size={13} />}<span className="truncate max-w-[180px]">{p.filename}</span>
                    </div>
                  ))}
                  <div dir="auto" className="whitespace-pre-wrap break-words">{(m.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n')}</div>
                </div>
              ) : (
                <div className="max-w-[94%] w-full text-[14px] text-slate-800">
                  <MessageParts message={m} t={t} language={language} freshIds={freshIds.current} />
                </div>
              )}
            </div>
          ))}

          {(status === 'submitted' || transcribing) && (
            <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.1s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" />
              </span>
              {transcribing ? t('agent.transcribing') : t('agent.thinking')}
            </div>
          )}

          {(error || localError) && (
            <div className="rounded-2xl bg-rose-50/90 ring-1 ring-rose-200 px-3 py-2 text-[12.5px] text-rose-800 flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div className="flex-1">{localError || agentErrorText(error, t)}</div>
              {error && !localError && (
                <button type="button" onClick={() => { clearError(); regenerate() }} className="inline-flex items-center gap-1 font-medium text-rose-700">
                  <RefreshCw size={13} />{t('agent.retry')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="px-2.5 pt-2 pb-[max(10px,env(safe-area-inset-bottom))] border-t border-white/60 bg-white/35">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2 px-1">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white ring-1 ring-slate-200 px-2 py-0.5 text-[11.5px] text-slate-700">
                  {f.type.startsWith('image/') ? <ImageIcon size={12} /> : <FileText size={12} />}
                  <span className="truncate max-w-[150px]">{f.name}</span>
                  <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={t('agent.remove')}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          {rec ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={cancelRecord} className="w-11 h-11 rounded-full bg-white ring-1 ring-slate-200 text-slate-600 flex items-center justify-center" aria-label={t('agent.cancel')}>
                <X size={18} />
              </button>
              <div className="flex-1 h-11 rounded-full bg-white/90 ring-1 ring-rose-200 flex items-center gap-2 px-3">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-[13px] tabular-nums text-rose-700 w-10">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
                <div className="flex-1 flex items-center gap-[3px] h-6 overflow-hidden" dir="ltr">
                  {Array.from({ length: 28 }).map((_, i) => (
                    <span key={i} className="w-[3px] rounded-full bg-rose-400/80 transition-all duration-100"
                      style={{ height: `${Math.max(12, Math.min(100, level * 100 * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + elapsed)))))}%` }} />
                  ))}
                </div>
              </div>
              <button type="button" onClick={toggleRecord} className="w-12 h-12 rounded-full bg-gradient-to-b from-rose-500 to-rose-600 text-white flex items-center justify-center shadow-[0_10px_22px_-10px_rgba(225,29,72,0.9)]" aria-label={t('agent.stop_send')}>
                <Square size={18} fill="currentColor" />
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || uploading}
                className="w-10 h-10 shrink-0 rounded-full bg-white/80 ring-1 ring-white text-slate-600 flex items-center justify-center disabled:opacity-50" aria-label={t('agent.attach')}>
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
              </button>
              <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden"
                onChange={(e) => { setFiles((x) => [...x, ...Array.from(e.target.files || [])].slice(0, 4)); e.target.value = '' }} />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                dir="auto"
                placeholder={t('agent.placeholder')}
                className="flex-1 min-w-0 resize-none max-h-32 rounded-[22px] bg-white/90 ring-1 ring-white focus:ring-blue-300 outline-none px-3.5 py-2.5 text-[14.5px] text-slate-800 placeholder:text-slate-400 shadow-sm"
                style={{ fieldSizing: 'content' }}
              />
              {busy ? (
                <button type="button" onClick={stop} className="w-12 h-12 shrink-0 rounded-full bg-slate-800 text-white flex items-center justify-center" aria-label={t('agent.stop')}>
                  <Square size={16} fill="currentColor" />
                </button>
              ) : input.trim() || files.length ? (
                <button type="button" onClick={() => send(input)} className="w-12 h-12 shrink-0 rounded-full bg-gradient-to-b from-blue-600 to-blue-700 text-white flex items-center justify-center shadow-[0_10px_22px_-10px_rgba(29,78,216,0.9)]" aria-label={t('agent.send')}>
                  <Send size={18} className="rtl:-scale-x-100" />
                </button>
              ) : (
                <button type="button" onClick={toggleRecord} disabled={!canRecord() || transcribing}
                  className="w-12 h-12 shrink-0 rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-[0_12px_24px_-10px_rgba(79,70,229,0.95)] disabled:opacity-50 active:scale-95" aria-label={t('agent.record')}>
                  {transcribing ? <Loader2 size={20} className="animate-spin" /> : <Mic size={21} />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </ActionStatusContext.Provider>
  )
}
