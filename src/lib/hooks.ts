'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDocs,
  limit as limitTo,
  onSnapshot,
  query,
  startAfter,
  type DocumentReference,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'

export interface LiveState<T> {
  data: T
  loading: boolean
  error: Error | null
  /** True while the data came from the local cache and the server has not confirmed it. */
  fromCache: boolean
}

const withId = <T,>(d: QueryDocumentSnapshot): T => ({ id: d.id, ...d.data() }) as T

/**
 * Realtime query. Pass null to skip (missing org, permission not yet known).
 * `key` must change whenever the query changes; queries are not comparable.
 */
export function useLiveQuery<T>(build: () => Query | null, key: string): LiveState<T[]> {
  const [state, setState] = useState<LiveState<T[]>>({ data: [], loading: true, error: null, fromCache: false })
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    const q = buildRef.current()
    if (!q) {
      setState({ data: [], loading: false, error: null, fromCache: false })
      return undefined
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    return onSnapshot(
      q,
      { includeMetadataChanges: false },
      (snap) => setState({ data: snap.docs.map((d) => withId<T>(d)), loading: false, error: null, fromCache: snap.metadata.fromCache }),
      (error) => setState({ data: [], loading: false, error, fromCache: false }),
    )
  }, [key])

  return state
}

export function useLiveDoc<T>(build: () => DocumentReference | null, key: string): LiveState<T | null> {
  const [state, setState] = useState<LiveState<T | null>>({ data: null, loading: true, error: null, fromCache: false })
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    const ref = buildRef.current()
    if (!ref) {
      setState({ data: null, loading: false, error: null, fromCache: false })
      return undefined
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    return onSnapshot(
      ref,
      (snap) =>
        setState({
          data: snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null,
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
        }),
      (error) => setState({ data: null, loading: false, error, fromCache: false }),
    )
  }, [key])

  return state
}

export interface PagedState<T> {
  items: T[]
  loading: boolean
  loadingMore: boolean
  error: Error | null
  hasMore: boolean
  loadMore: () => void
  reload: () => void
  /** Replace one loaded row after a local edit, without refetching the page. */
  patch: (id: string, change: Partial<T> | null) => void
}

/**
 * One-shot cursor pagination for long lists (backlog, audit log, all items).
 * Pages are fetched on demand, so a 5,000-item backlog costs one page of reads
 * until someone scrolls, not 5,000 reads on every visit.
 */
export function usePagedQuery<T extends { id: string }>(build: () => Query | null, key: string, pageSize = 50): PagedState<T> {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const cursor = useRef<QueryDocumentSnapshot | null>(null)
  const [nonce, setNonce] = useState(0)
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    let cancelled = false
    const base = buildRef.current()
    cursor.current = null
    if (!base) {
      setItems([])
      setLoading(false)
      setHasMore(false)
      return undefined
    }
    setLoading(true)
    setError(null)
    getDocs(query(base, limitTo(pageSize)))
      .then((snap) => {
        if (cancelled) return
        cursor.current = snap.docs.at(-1) ?? null
        setItems(snap.docs.map((d) => withId<T>(d)))
        setHasMore(snap.size === pageSize)
      })
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [key, pageSize, nonce])

  const loadMore = useCallback(() => {
    const base = buildRef.current()
    if (!base || !cursor.current) return
    setLoadingMore(true)
    getDocs(query(base, startAfter(cursor.current), limitTo(pageSize)))
      .then((snap) => {
        cursor.current = snap.docs.at(-1) ?? cursor.current
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          return [...prev, ...snap.docs.map((d) => withId<T>(d)).filter((d) => !seen.has(d.id))]
        })
        setHasMore(snap.size === pageSize)
      })
      .catch(setError)
      .finally(() => setLoadingMore(false))
  }, [pageSize])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const patch = useCallback((id: string, change: Partial<T> | null) => {
    setItems((prev) => (change === null ? prev.filter((p) => p.id !== id) : prev.map((p) => (p.id === id ? { ...p, ...change } : p))))
  }, [])

  return { items, loading, loadingMore, error, hasMore, loadMore, reload, patch }
}

/** One-shot read with loading/error state. */
export function useFetch<T>(run: (() => Promise<T>) | null, key: string) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: Error | null }>({ data: null, loading: true, error: null })
  const runRef = useRef(run)
  runRef.current = run
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const fn = runRef.current
    if (!fn) {
      setState({ data: null, loading: false, error: null })
      return undefined
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    fn()
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((error) => !cancelled && setState({ data: null, loading: false, error }))
    return () => {
      cancelled = true
    }
  }, [key, nonce])

  return { ...state, reload: () => setNonce((n) => n + 1) }
}

export function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  return online
}

/** Wraps an async action with pending/error state for buttons and forms. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true)
    setError(null)
    try {
      return await fnRef.current(...args)
    } catch (err) {
      setError(err)
      return undefined
    } finally {
      setPending(false)
    }
  }, [])
  return { run, pending, error, setError }
}
