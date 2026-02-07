import { useLanguage } from '../context/LanguageContext'
import { Globe } from './ui/Icons'

function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage()

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'ar' : 'en')
  }

  return (
    <button
      onClick={toggleLanguage}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-blue-100 hover:bg-blue-600 transition-colors"
      aria-label={`Switch to ${language === 'en' ? 'Arabic' : 'English'}`}
      title={`Switch to ${language === 'en' ? 'Arabic' : 'English'}`}
    >
      <Globe size={18} />
      <span className="text-sm font-medium uppercase">{language === 'en' ? 'AR' : 'EN'}</span>
    </button>
  )
}

export default LanguageSwitcher
