import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, X, Plus, History, Volume2, VolumeX, Maximize2, Minimize2, Loader2, ChevronLeft, Activity } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { useIsPhone } from '../../hooks/useMediaQuery'

const AgentChat = lazy(() => import('./AgentChat'))
const CONV_KEY = 'promed.agent.conversation'

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`)

/** Is the signed-in user the owner? (The agent is the owner's tool.) */
function useIsOwner(user) {
  const [owner, setOwner] = useState(false)
  useEffect(() => {
    let alive = true
    if (!user?.id) { setOwner(false); return undefined }
    supabase.from('app_members').select('role').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (alive) setOwner(data?.role === 'owner') })
    return () => { alive = false }
  }, [user?.id])
  return owner
}

export default function AgentDock() {
  const { user } = useAuth()
  const { t, language } = useLanguage()
  const isPhone = useIsPhone()
  const isOwner = useIsOwner(user)
  const [open, setOpen] = useState(false)
  const [wide, setWide] = useState(false)
  const [conversationId, setConversationId] = useState(() => {
    try { return localStorage.getItem(CONV_KEY) || newId() } catch { return newId() }
  })
  const [initial, setInitial] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState([])
  const [settings, setSettings] = useState({ voice_replies: false, auto_save_limit: 5000 })

  useEffect(() => {
    try { localStorage.setItem(CONV_KEY, conversationId) } catch { /* private mode */ }
  }, [conversationId])

  // Open from anywhere: window.dispatchEvent(new CustomEvent('promed:agent-open'))
  useEffect(() => {
    const h = () => setOpen(true)
    window.addEventListener('promed:agent-open', h)
    return () => window.removeEventListener('promed:agent-open', h)
  }, [])

  // Keyboard: Ctrl/Cmd + J toggles the agent.
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen((v) => !v) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const loadConversation = useCallback(async (id) => {
    setInitial(null)
    const { data } = await supabase.from('agent_messages').select('message_id, role, parts').eq('conversation_id', id).order('id')
    setInitial((data || []).map((m) => ({ id: m.message_id, role: m.role, parts: m.parts })))
  }, [])

  useEffect(() => {
    if (open && isOwner && initial === null) loadConversation(conversationId)
  }, [open, isOwner, conversationId, initial, loadConversation])

  useEffect(() => {
    if (!open || !isOwner) return
    supabase.from('agent_settings').select('voice_replies, auto_save_limit').maybeSingle()
      .then(({ data }) => { if (data) setSettings(data) })
  }, [open, isOwner])

  const loadHistory = async () => {
    const { data } = await supabase.from('agent_conversations').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(40)
    setHistory(data || [])
  }

  const startNew = () => {
    setShowHistory(false)
    setInitial([])
    setConversationId(newId())
  }

  const pick = (id) => {
    setShowHistory(false)
    setConversationId(id)
    setInitial(null)
    loadConversation(id)
  }

  const toggleVoice = async () => {
    const next = !settings.voice_replies
    setSettings((s) => ({ ...s, voice_replies: next }))
    await supabase.rpc('agent_set_settings', { p_voice_replies: next })
  }

  if (!user || !isOwner) return null

  const panelClass = isPhone
    ? 'fixed inset-0 z-[60] flex flex-col'
    : `fixed z-[60] top-3 bottom-3 end-3 flex flex-col rounded-[28px] overflow-hidden ${wide ? 'w-[min(760px,calc(100vw-17rem))]' : 'w-[420px]'}`

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="no-print fixed z-[45] end-4 md:end-6 md:bottom-6 w-14 h-14 rounded-full text-white flex items-center justify-center bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 shadow-[0_16px_34px_-12px_rgba(79,70,229,0.95)] ring-4 ring-white/60 active:scale-95 transition-transform"
          style={isPhone ? { bottom: 'calc(max(10px, env(safe-area-inset-bottom, 0px)) + 78px)' } : undefined}
          aria-label={t('agent.open')}
          title={`${t('agent.open')} (Ctrl+J)`}
        >
          <Sparkles size={24} />
        </button>
      )}

      {open && (
        <div className={`${panelClass} no-print`} role="dialog" aria-label={t('agent.title')}>
          <div className="absolute inset-0 -z-10 app-wallpaper" />
          <div className="absolute inset-0 -z-10 bg-white/35 backdrop-blur-xl" />
          {/* Header */}
          <div className="flex items-center gap-2 px-3 pb-2 pt-[max(10px,env(safe-area-inset-top))] border-b border-white/60 bg-white/40">
            {showHistory ? (
              <button type="button" onClick={() => setShowHistory(false)} className="w-9 h-9 rounded-full hover:bg-white/70 flex items-center justify-center" aria-label={t('agent.back')}>
                <ChevronLeft size={20} className="rtl:rotate-180" />
              </button>
            ) : (
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-sm"><Sparkles size={18} /></span>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-[#0b2a55] leading-tight">{showHistory ? t('agent.history') : t('agent.title')}</div>
              {!showHistory && <div className="text-[11px] text-slate-500 truncate">{t('agent.subtitle', { n: Number(settings.auto_save_limit).toLocaleString('en-US') })}</div>}
            </div>
            <button type="button" onClick={toggleVoice} className="w-9 h-9 rounded-full hover:bg-white/70 flex items-center justify-center text-slate-600" title={t('agent.voice_replies')} aria-pressed={settings.voice_replies}>
              {settings.voice_replies ? <Volume2 size={18} className="text-blue-700" /> : <VolumeX size={18} />}
            </button>
            <Link to="/agent" onClick={() => isPhone && setOpen(false)} className="w-9 h-9 rounded-full hover:bg-white/70 hidden sm:flex items-center justify-center text-slate-600" title={t('nav.agent')}>
              <Activity size={18} />
            </Link>
            <button type="button" onClick={() => { setShowHistory((v) => !v); loadHistory() }} className="w-9 h-9 rounded-full hover:bg-white/70 flex items-center justify-center text-slate-600" title={t('agent.history')}>
              <History size={18} />
            </button>
            <button type="button" onClick={startNew} className="w-9 h-9 rounded-full hover:bg-white/70 flex items-center justify-center text-slate-600" title={t('agent.new_chat')}>
              <Plus size={19} />
            </button>
            {!isPhone && (
              <button type="button" onClick={() => setWide((v) => !v)} className="w-9 h-9 rounded-full hover:bg-white/70 flex items-center justify-center text-slate-600" title={wide ? t('agent.narrow') : t('agent.wide')}>
                {wide ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="w-9 h-9 rounded-full hover:bg-white/70 flex items-center justify-center text-slate-700" aria-label={t('agent.close')}>
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 min-h-0">
            {showHistory ? (
              <div className="h-full overflow-y-auto p-3 space-y-1.5">
                {history.length === 0 && <div className="text-center text-[13px] text-slate-500 pt-8">{t('agent.no_history')}</div>}
                {history.map((h) => (
                  <button key={h.id} type="button" onClick={() => pick(h.id)}
                    className={`w-full text-start rounded-2xl px-3 py-2.5 ring-1 ${h.id === conversationId ? 'bg-white ring-blue-200' : 'bg-white/70 ring-white hover:bg-white'}`}>
                    <div className="text-[13.5px] text-slate-800 truncate">{h.title || t('agent.new_chat')}</div>
                    <div className="text-[11px] text-slate-400">{new Date(h.updated_at).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </button>
                ))}
              </div>
            ) : initial === null ? (
              <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
            ) : (
              <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>}>
                <AgentChat
                  key={conversationId}
                  conversationId={conversationId}
                  initialMessages={initial}
                  user={user}
                  t={t}
                  language={language}
                  voiceReplies={settings.voice_replies}
                />
              </Suspense>
            )}
          </div>
        </div>
      )}
    </>
  )
}
