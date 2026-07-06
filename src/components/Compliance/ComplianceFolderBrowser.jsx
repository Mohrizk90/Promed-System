// Folder-style browser: grid of folders → open one → simple list inside.
import { useMemo } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { folderPalette, resolveFolderLabel } from '../../utils/complianceFolders'
import { FolderOpen, ChevronLeft, ChevronRight, Search } from '../ui/Icons'

export default function ComplianceFolderBrowser({
  folders,
  selectedKey,
  onSelectKey,
  renderItem,
  searchQuery = '',
  onSearchChange,
  searchPlaceholder,
  emptyTitle,
  emptyHint,
}) {
  const { t } = useLanguage()

  const decorated = useMemo(() => (
    folders.map((f, i) => ({
      ...f,
      label: resolveFolderLabel(f.key, t),
      palette: folderPalette(i),
    }))
  ), [folders, t])

  const active = decorated.find((f) => f.key === selectedKey)

  const filteredInFolder = useMemo(() => {
    if (!active) return []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return active.items
    return active.items.filter((item) => renderItem.matchesSearch?.(item, q) !== false)
  }, [active, searchQuery, renderItem])

  const filteredFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return decorated
    return decorated.filter((f) => (
      f.label.toLowerCase().includes(q)
      || f.items.some((item) => renderItem.matchesSearch?.(item, q))
    ))
  }, [decorated, searchQuery, renderItem])

  if (!selectedKey) {
    return (
      <div className="space-y-3">
        {onSearchChange && (
          <div className="relative max-w-md">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder || t('common.searchPlaceholder')}
              className="input w-full ps-9 py-2.5 text-sm rounded-xl border-gray-200"
            />
          </div>
        )}

        {filteredFolders.length === 0 ? (
          <div className="text-center py-12 px-4 bg-white rounded-xl border border-gray-200">
            <FolderOpen size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="font-semibold text-gray-800">{emptyTitle}</p>
            {emptyHint && <p className="text-sm text-gray-500 mt-1">{emptyHint}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredFolders.map((folder) => {
              const p = folder.palette
              return (
                <button
                  key={folder.key}
                  type="button"
                  onClick={() => onSelectKey(folder.key)}
                  className={`text-start rounded-2xl border-2 p-4 transition-all hover:shadow-md hover:scale-[1.01] ${p.bg} ${p.border}`}
                >
                  <FolderOpen size={32} className={`mb-2 ${p.icon}`} />
                  <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">{folder.label}</p>
                  <p className={`inline-block mt-2 text-xs font-semibold px-2 py-0.5 rounded-full ${p.badge}`}>
                    {t('compliance.folders.count', { count: folder.count })}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (!active) return null

  const p = active.palette

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onSelectKey(null)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-700 hover:underline"
      >
        <ChevronLeft size={16} /> {t('compliance.folders.back')}
      </button>

      <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${p.bg} ${p.border}`}>
        <FolderOpen size={28} className={p.icon} />
        <div>
          <h3 className="font-bold text-gray-900">{active.label}</h3>
          <p className="text-xs text-gray-600">{t('compliance.folders.count', { count: active.count })}</p>
        </div>
      </div>

      {onSearchChange && (
        <div className="relative max-w-md">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder || t('common.searchPlaceholder')}
            className="input w-full ps-9 py-2.5 text-sm rounded-xl border-gray-200"
          />
        </div>
      )}

      {filteredInFolder.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">{t('compliance.folders.empty_folder')}</p>
      ) : (
        <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 shadow-sm">
          {filteredInFolder.map((item) => (
            <li key={renderItem.key(item)}>
              {renderItem.render(item, (
                <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
