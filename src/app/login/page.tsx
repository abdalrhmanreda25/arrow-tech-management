'use client'

import { Suspense, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import AuthCard from '@/components/AuthCard'
import GoogleButton from '@/components/GoogleButton'
import Alert from '@/components/ui/Alert'
import Field from '@/components/ui/Field'
import { useAuth } from '@/components/providers/AuthProvider'
import { friendlyError } from '@/lib/errors'

/** Only same-site paths are followed after sign-in, never absolute URLs. */
const safeNext = (value: string | null) => (value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard/')

function LoginForm() {
  const { user, signIn, signInWithGoogle } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) router.replace(next)
  }, [user, next, router])

  const run = async (fn: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(() => signIn(email, password))
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Arrow Tech team management"
      footer={
        <>
          New here? <Link className="text-link" href={`/signup/?next=${encodeURIComponent(next)}`}>Create an account</Link>
        </>
      }
    >
      {params.get('verified') ? <Alert type="success">Email verified. Sign in to continue.</Alert> : null}
      {error ? <Alert type="error">{error}</Alert> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email">
          {(p) => <input {...p} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password">
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <button className="btn btn-accent btn-block" disabled={pending || !email || !password}>
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <div className="divider">or</div>
      <GoogleButton onClick={() => run(signInWithGoogle)} disabled={pending} />
      <p className="center muted small" style={{ marginTop: 16 }}>
        <Link className="text-link" href="/reset-password/">Forgot your password?</Link>
      </p>
    </AuthCard>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
