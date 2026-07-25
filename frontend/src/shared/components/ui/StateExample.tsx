/**
 * Four-state reference component (empty / loading / error / ready).
 *
 * This is the canonical pattern for rendering async data in Linearr: never
 * assume "ready". Model the fetch as a `Result<T>` discriminated union and
 * render every state explicitly, reusing the shared primitives.
 *
 * Copy this shape into a feature component; it is not imported anywhere by
 * default (it's a documented example, referenced from docs/DESIGN_SYSTEM.md).
 */
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { Spinner } from './Spinner'

/** Discriminated union — the exhaustive set of states an async read can be in. */
export type Result<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; data: T }

export interface StateExampleProps<T> {
  result: Result<T>
  /** Ready-state renderer — only called when data is present and non-empty. */
  children: (data: T) => React.ReactNode
  /** Retry handler for the error state. */
  onRetry?: () => void
  emptyTitle?: string
  emptyDescription?: string
}

export function StateExample<T>({
  result,
  children,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
}: StateExampleProps<T>) {
  switch (result.status) {
    case 'loading':
      return (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Spinner size="md" />
          <span className="sr-only">Loading…</span>
        </div>
      )

    case 'error':
      return (
        <EmptyState
          title="Something went wrong"
          description={result.message}
          action={
            onRetry ? (
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        />
      )

    case 'empty':
      return <EmptyState title={emptyTitle} description={emptyDescription} />

    case 'ready':
      return <>{children(result.data)}</>
  }
}

/**
 * Adapter from a TanStack React Query result to a `Result<T>`. Feature code can
 * map a `useQuery(...)` return straight into the component above:
 *
 *   const q = usePlexLibraries()
 *   return <StateExample result={toResult(q, (d) => d.length === 0)}>{...}</StateExample>
 */
export function toResult<T>(
  query: { isPending: boolean; isError: boolean; error?: unknown; data?: T },
  isEmpty: (data: T) => boolean = () => false,
): Result<T> {
  if (query.isPending) return { status: 'loading' }
  if (query.isError)
    return {
      status: 'error',
      message: query.error instanceof Error ? query.error.message : 'Request failed',
    }
  if (query.data === undefined) return { status: 'loading' }
  if (isEmpty(query.data)) return { status: 'empty' }
  return { status: 'ready', data: query.data }
}
