// App-wide error boundary. Without this, any render error unmounts the whole
// tree and the user sees a blank white page. This catches the error, and:
//   - for stale lazy-chunk errors after a new deploy, auto-reloads once,
//   - otherwise shows a friendly recovery screen with reload / go-home.
import { Component } from 'react'

const CHUNK_ERROR = /(loading chunk|dynamically imported module|failed to fetch dynamically|importing a module script failed)/i
const RELOAD_FLAG = 'promed_chunk_reloaded'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // A stale chunk after a fresh deploy: reload once to fetch new assets.
    if (CHUNK_ERROR.test(error?.message || '')) {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1')
        window.location.reload()
        return
      }
    }
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  handleReload = () => {
    sessionStorage.removeItem(RELOAD_FLAG)
    window.location.reload()
  }

  handleHome = () => {
    sessionStorage.removeItem(RELOAD_FLAG)
    window.location.assign('/')
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="max-w-md">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-sm text-gray-600 mb-5">
            The page hit an unexpected error. Reloading usually fixes it. If it keeps
            happening, go back to the home screen.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-semibold"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.handleHome}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-semibold"
            >
              Go to home
            </button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-4 text-left text-[11px] text-red-700 bg-red-50 p-3 rounded overflow-auto max-h-40">
              {String(this.state.error.stack || this.state.error.message)}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
