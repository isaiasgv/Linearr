import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Logo } from './Logo'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex h-screen bg-slate-950 text-slate-100 items-center justify-center">
        <div className="max-w-md text-center space-y-4 px-6">
          <Logo size={48} className="mx-auto" />
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-slate-400">
            Linearr encountered an unexpected error. Try refreshing the page.
          </p>
          {this.state.error && (
            <pre className="text-xs text-left bg-slate-900 border border-slate-700 rounded-lg p-3 overflow-auto max-h-40 text-red-400">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
