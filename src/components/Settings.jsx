import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'
import { downloadCsv } from '../utils/exportCsv'
import {
  User as UserIcon,
  Globe,
  LogOut,
  Download,
  CreditCard,
  Mail,
  Spinner,
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
  const [exporting, setExporting] = useState(false)

  const handlePaymentTermsChange = (value) => {
    setDefaultPaymentTerms(value)
    localStorage.setItem('defaultPaymentTerms', value)
    success(t('settings.saved'))
  }

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
