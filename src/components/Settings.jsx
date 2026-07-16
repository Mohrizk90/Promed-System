import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'
import { downloadCsv } from '../utils/exportCsv'
import { getCompanySettingsForm, saveCompanySettings } from '../utils/companySettings'
import { getInvoiceSettings, saveInvoiceSettings, peekNextInvoiceNumber } from '../utils/invoiceSettings'
import {
  User as UserIcon,
  Globe,
  LogOut,
  Download,
  CreditCard,
  Mail,
  Spinner,
  FileText,
  MessageSquare,
} from './ui/Icons'

const PAYMENT_TERMS_OPTIONS = [
  { value: 'none', labelEn: 'None', labelAr: 'بدون' },
  { value: 'cod', labelEn: 'Cash on Delivery', labelAr: 'الدفع عند التسليم' },
  { value: 'net_15', labelEn: 'Net 15', labelAr: 'صافي 15 يوم' },
  { value: 'net_30', labelEn: 'Net 30', labelAr: 'صافي 30 يوم' },
  { value: 'net_60', labelEn: 'Net 60', labelAr: 'صافي 60 يوم' },
  { value: 'net_90', labelEn: 'Net 90', labelAr: 'صافي 90 يوم' },
]

export default function Settings() {
  const { user, signOut } = useAuth()
  const { t, language, setLanguage } = useLanguage()
  const { success, error: showError } = useToast()
  const navigate = useNavigate()

  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState(
    () => localStorage.getItem('defaultPaymentTerms') || 'none'
  )
  const [companyForm, setCompanyForm] = useState(() => getCompanySettingsForm())
  const [invoiceForm, setInvoiceForm] = useState(() => {
    const s = getInvoiceSettings()
    return {
      invoicePrefix: s.invoicePrefix,
      nextNumber: String(s.nextNumber),
      padWidth: String(s.padWidth),
    }
  })
  const [exporting, setExporting] = useState(false)
  const [telegramCode, setTelegramCode] = useState('')
  const [telegramLink, setTelegramLink] = useState(null)
  const [telegramLinking, setTelegramLinking] = useState(false)
  const [telegramUnlinking, setTelegramUnlinking] = useState(false)

  const fetchTelegramLink = async () => {
    try {
      const { data, error } = await supabase
        .from('telegram_links')
        .select('telegram_chat_id, telegram_username, linked_at')
        .maybeSingle()
      if (error) throw error
      setTelegramLink(data || null)
    } catch (err) {
      // Table might not exist yet; keep silent
      setTelegramLink(null)
    }
  }

  useEffect(() => {
    fetchTelegramLink()
  }, [])

  const handleLinkTelegram = async (e) => {
    e?.preventDefault?.()
    const code = telegramCode.trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      showError('Code must be 6 characters (A-Z, 0-9)')
      return
    }
    setTelegramLinking(true)
    try {
      const { error } = await supabase.rpc('claim_telegram_link', { p_code: code })
      if (error) throw error
      success('Telegram linked')
      setTelegramCode('')
      await fetchTelegramLink()
    } catch (err) {
      showError(err.message || 'Failed to link Telegram')
    } finally {
      setTelegramLinking(false)
    }
  }

  const handleUnlinkTelegram = async () => {
    setTelegramUnlinking(true)
    try {
      const { error } = await supabase
        .from('telegram_links')
        .delete()
        .eq('user_id', user?.id)
      if (error) throw error
      success('Telegram unlinked')
      setTelegramLink(null)
    } catch (err) {
      showError(err.message || 'Failed to unlink Telegram')
    } finally {
      setTelegramUnlinking(false)
    }
  }

  const handlePaymentTermsChange = (value) => {
    setDefaultPaymentTerms(value)
    localStorage.setItem('defaultPaymentTerms', value)
    success(t('settings.saved'))
  }

  const handleCompanySave = (e) => {
    e.preventDefault()
    saveCompanySettings(companyForm)
    success(t('settings.saved'))
  }

  const handleInvoiceNumberingSave = (e) => {
    e.preventDefault()
    saveInvoiceSettings({
      invoicePrefix: invoiceForm.invoicePrefix,
      nextNumber: parseInt(invoiceForm.nextNumber, 10),
      padWidth: parseInt(invoiceForm.padWidth, 10),
    })
    success(t('settings.saved'))
  }

  const invoicePreview = peekNextInvoiceNumber()

  const handleExportAll = async () => {
    setExporting(true)
    try {
      const tables = [
        { name: 'clients', query: supabase.from('clients').select('*') },
        { name: 'suppliers', query: supabase.from('suppliers').select('*') },
        { name: 'products', query: supabase.from('products').select('*') },
        { name: 'client_transactions', query: supabase.from('client_transactions').select('*') },
        { name: 'supplier_transactions', query: supabase.from('supplier_transactions').select('*') },
        { name: 'payments', query: supabase.from('payments').select('*') },
        { name: 'liabilities', query: supabase.from('liabilities').select('*') },
        { name: 'liability_payments', query: supabase.from('liability_payments').select('*') },
      ]

      for (const table of tables) {
        const { data, error } = await table.query
        if (error) {
          showError(`Error exporting ${table.name}: ${error.message}`)
          continue
        }
        if (data && data.length > 0) {
          downloadCsv(`promed_${table.name}.csv`, data)
        }
      }
      success(t('settings.exportSuccess'))
    } catch (err) {
      showError(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="max-w-2xl mx-auto py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('settings.title')}</h1>
        <p className="text-gray-500 mt-1">{t('settings.subtitle')}</p>
      </div>

      {/* Profile Section */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <UserIcon size={20} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('settings.profile')}</h2>
            <p className="text-sm text-gray-500">{t('settings.profileDesc')}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">{t('settings.email')}</label>
            <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
              <Mail size={16} className="text-gray-400" />
              <span className="text-gray-700">{user?.email || '—'}</span>
            </div>
          </div>
          <div>
            <label className="label">{t('settings.displayName')}</label>
            <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
              <UserIcon size={16} className="text-gray-400" />
              <span className="text-gray-700">{user?.user_metadata?.full_name || user?.email?.split('@')[0] || '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Language Section */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
            <Globe size={20} className="text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('settings.language')}</h2>
            <p className="text-sm text-gray-500">{t('settings.languageDesc')}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setLanguage('en')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
              language === 'en'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            English
          </button>
          <button
            onClick={() => setLanguage('ar')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
              language === 'ar'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            العربية
          </button>
        </div>
      </div>

      {/* Company Information */}
      <form onSubmit={handleCompanySave} className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
            <FileText size={20} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('settings.companyInfo')}</h2>
            <p className="text-sm text-gray-500">{t('settings.companyInfoDesc')}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">{t('settings.companyName')}</label>
            <input
              type="text"
              className="input"
              value={companyForm.companyName}
              onChange={(e) => setCompanyForm({ ...companyForm, companyName: e.target.value })}
              placeholder="Promed"
            />
          </div>
          <div>
            <label className="label">{t('settings.companyAddress')}</label>
            <input
              type="text"
              className="input"
              value={companyForm.companyAddress}
              onChange={(e) => setCompanyForm({ ...companyForm, companyAddress: e.target.value })}
              placeholder={t('settings.companyAddressPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('settings.companyPhone')}</label>
              <input
                type="text"
                className="input"
                value={companyForm.companyPhone}
                onChange={(e) => setCompanyForm({ ...companyForm, companyPhone: e.target.value })}
                placeholder={t('settings.companyPhonePlaceholder')}
              />
            </div>
            <div>
              <label className="label">{t('settings.companyEmail')}</label>
              <input
                type="email"
                className="input"
                value={companyForm.companyEmail}
                onChange={(e) => setCompanyForm({ ...companyForm, companyEmail: e.target.value })}
                placeholder={t('settings.companyEmailPlaceholder')}
              />
            </div>
          </div>
          <div>
            <label className="label">{t('settings.companyTagline')}</label>
            <input
              type="text"
              className="input"
              value={companyForm.companyTagline}
              onChange={(e) => setCompanyForm({ ...companyForm, companyTagline: e.target.value })}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            {t('settings.saveCompanyInfo')}
          </button>
        </div>
      </form>

      {/* Invoice numbering */}
      <form onSubmit={handleInvoiceNumberingSave} className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <FileText size={20} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('settings.invoiceNumbering')}</h2>
            <p className="text-sm text-gray-500">{t('settings.invoiceNumberingDesc')}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">{t('settings.invoicePrefix')}</label>
              <input
                type="text"
                className="input"
                value={invoiceForm.invoicePrefix}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, invoicePrefix: e.target.value })}
                placeholder="INV"
              />
            </div>
            <div>
              <label className="label">{t('settings.invoiceNextNumber')}</label>
              <input
                type="number"
                min="1"
                className="input"
                value={invoiceForm.nextNumber}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, nextNumber: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('settings.invoicePadWidth')}</label>
              <input
                type="number"
                min="3"
                max="8"
                className="input"
                value={invoiceForm.padWidth}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, padWidth: e.target.value })}
              />
            </div>
          </div>
          <p className="text-sm text-gray-600">
            {t('settings.invoiceNextPreview')}: <span className="font-semibold text-gray-900">{invoicePreview}</span>
          </p>
          <button type="submit" className="btn btn-primary">
            {t('settings.saveInvoiceNumbering')}
          </button>
        </div>
      </form>

      {/* Default Payment Terms */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
            <CreditCard size={20} className="text-purple-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('settings.defaultPaymentTerms')}</h2>
            <p className="text-sm text-gray-500">{t('settings.defaultPaymentTermsDesc')}</p>
          </div>
        </div>
        <select
          value={defaultPaymentTerms}
          onChange={(e) => handlePaymentTermsChange(e.target.value)}
          className="input"
        >
          {PAYMENT_TERMS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {language === 'ar' ? opt.labelAr : opt.labelEn}
            </option>
          ))}
        </select>
      </div>

      {/* Export Data */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
            <Download size={20} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('settings.exportData')}</h2>
            <p className="text-sm text-gray-500">{t('settings.exportDataDesc')}</p>
          </div>
        </div>
        <button
          onClick={handleExportAll}
          disabled={exporting}
          className="btn btn-secondary w-full"
        >
          {exporting ? <Spinner size="sm" /> : <Download size={18} />}
          {exporting ? t('settings.exporting') : t('settings.exportAll')}
        </button>
      </div>

      {/* Telegram Bot */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center">
            <MessageSquare size={20} className="text-sky-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('settings.telegram.title')}</h2>
            <p className="text-sm text-gray-500">{t('settings.telegram.description')}</p>
          </div>
        </div>
        {telegramLink ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-green-800">
                {t('settings.telegram.linked')}: <span className="font-mono font-semibold">{telegramLink.telegram_chat_id}</span>
                {telegramLink.telegram_username ? ` (@${telegramLink.telegram_username})` : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={handleUnlinkTelegram}
              disabled={telegramUnlinking}
              className="btn btn-secondary w-full"
            >
              {telegramUnlinking ? <Spinner size="sm" /> : <LogOut size={18} />}
              {t('settings.telegram.unlinkButton')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleLinkTelegram} className="space-y-3">
            <div>
              <label className="label">{t('settings.telegram.codePlaceholder')}</label>
              <input
                type="text"
                className="input font-mono uppercase tracking-widest"
                value={telegramCode}
                onChange={(e) => setTelegramCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder={t('settings.telegram.codePlaceholder')}
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              type="submit"
              disabled={telegramLinking || telegramCode.length !== 6}
              className="btn btn-primary w-full"
            >
              {telegramLinking ? <Spinner size="sm" /> : <MessageSquare size={18} />}
              {t('settings.telegram.linkButton')}
            </button>
          </form>
        )}
      </div>

      {/* Sign Out */}
      <div className="card p-6">
        <button
          onClick={handleSignOut}
          className="btn btn-danger w-full"
        >
          <LogOut size={18} />
          {t('settings.signOut')}
        </button>
      </div>
    </div>
  )
}
