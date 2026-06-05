const STORAGE_KEYS = {
  companyName: 'companyName',
  companyAddress: 'companyAddress',
  companyPhone: 'companyPhone',
  companyEmail: 'companyEmail',
  companyTagline: 'companyTagline',
}

export const DEFAULT_COMPANY_SETTINGS = {
  companyName: 'Promed for Manufacturing',
  companyAddress: '3rd Industrial, October City',
  companyPhone: '(122) 399-7576',
  companyEmail: 'grizk1965@gmail.com',
  companyTagline: '',
}

export function getCompanySettings() {
  return {
    companyName: localStorage.getItem(STORAGE_KEYS.companyName) || DEFAULT_COMPANY_SETTINGS.companyName,
    companyAddress: localStorage.getItem(STORAGE_KEYS.companyAddress) || DEFAULT_COMPANY_SETTINGS.companyAddress,
    companyPhone: localStorage.getItem(STORAGE_KEYS.companyPhone) || DEFAULT_COMPANY_SETTINGS.companyPhone,
    companyEmail: localStorage.getItem(STORAGE_KEYS.companyEmail) || DEFAULT_COMPANY_SETTINGS.companyEmail,
    companyTagline: localStorage.getItem(STORAGE_KEYS.companyTagline) || DEFAULT_COMPANY_SETTINGS.companyTagline,
  }
}

export function saveCompanySettings(settings) {
  Object.entries(STORAGE_KEYS).forEach(([field, key]) => {
    const value = settings[field] ?? ''
    localStorage.setItem(key, value)
  })
}
