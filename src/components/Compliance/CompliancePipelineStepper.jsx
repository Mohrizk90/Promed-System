// Visual pipeline: Upload → AI extraction → Review → Filed
import { useLanguage } from '../../context/LanguageContext'
import { Upload, RefreshCw, Eye, CheckCircle } from '../ui/Icons'

const STEPS = [
  { key: 'upload', Icon: Upload },
  { key: 'extract', Icon: RefreshCw },
  { key: 'review', Icon: Eye },
  { key: 'filed', Icon: CheckCircle },
]

export default function CompliancePipelineStepper({ activeStep = 1 }) {
  const { t } = useLanguage()
  const step = Math.min(Math.max(activeStep, 1), 4)

  return (
    <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-0 sm:flex sm:items-center sm:justify-between print:hidden">
      {STEPS.map(({ key, Icon }, index) => {
        const n = index + 1
        const done = n < step
        const current = n === step
        return (
          <li key={key} className="flex items-center gap-2 sm:flex-1 sm:min-w-0">
            <div
              className={`flex items-center gap-2 min-w-0 rounded-lg px-2.5 py-2 w-full sm:w-auto ${
                current ? 'bg-rose-50 ring-1 ring-rose-200' : done ? 'bg-green-50' : 'bg-gray-50'
              }`}
            >
              <span
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  current ? 'bg-rose-600 text-white'
                    : done ? 'bg-green-600 text-white'
                      : 'bg-gray-200 text-gray-600'
                }`}
              >
                {done ? <CheckCircle size={16} /> : n}
              </span>
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${current ? 'text-rose-800' : 'text-gray-800'}`}>
                  {t(`compliance.workflow.step_${key}`)}
                </p>
                <p className="text-[10px] text-gray-500 truncate hidden sm:block">
                  {t(`compliance.workflow.step_${key}_hint`)}
                </p>
              </div>
              <Icon size={16} className={`hidden sm:block flex-shrink-0 ${current ? 'text-rose-600' : 'text-gray-400'}`} />
            </div>
            {index < STEPS.length - 1 && (
              <div className="hidden sm:block flex-1 h-0.5 mx-1 bg-gray-200 min-w-[12px]" aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}
