const STORAGE_KEYS = {
  companyName: 'companyName',
  companyAddress: 'companyAddress',
  companyPhone: 'companyPhone',
  companyEmail: 'companyEmail',
  companyTagline: 'companyTagline',
}

const FALLBACK_COMPANY_NAME = 'Promed'

function readStored(key) {
  const value = localStorage.getItem(STORAGE_KEYS[key])
  return value == null ? '' : value
}

/** Settings form / empty state – no fabricated contact details. */
export function getCompanySettingsForm() {
  return {
    companyName: readStored('companyName'),
    companyAddress: readStored('companyAddress'),
    companyPhone: readStored('companyPhone'),
    companyEmail: readStored('companyEmail'),
    companyTagline: readStored('companyTagline'),
  }
}

/** Statement / invoice letterhead – only saved values, minimal name fallback. */
export function getCompanySettings() {
  const form = getCompanySettingsForm()
  return {
    companyName: form.companyName.trim() || FALLBACK_COMPANY_NAME,
    companyAddress: form.companyAddress.trim(),
    companyPhone: form.companyPhone.trim(),
    companyEmail: form.companyEmail.trim(),
    companyTagline: form.companyTagline.trim(),
  }
}

export function saveCompanySettings(settings) {
  Object.entries(STORAGE_KEYS).forEach(([field, key]) => {
    localStorage.setItem(key, (settings[field] ?? '').trim())
  })
}
