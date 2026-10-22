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

const safeNext = (value: string | null) => (value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard/')

function SignupForm() {
  const { user, signUp, signInWithGoogle } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get('next'))
  const [name, setName] = useState('')
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

  const tooShort = password.length > 0 && password.length < 8

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters for your password.')
    run(() => signUp(name, email, password))
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="We will email you a link to verify your address."
      footer={
        <>
          Already have an account? <Link className="text-link" href={`/login/?next=${encodeURIComponent(next)}`}>Sign in</Link>
        </>
      }
    >
      {error ? <Alert type="error">{error}</Alert> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Full name">
          {(p) => <input {...p} className="input" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Work email">
          {(p) => <input {...p} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={tooShort ? 'Too short' : undefined}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <button className="btn btn-accent btn-block" disabled={pending || !name.trim() || !email || !password}>
          {pending ? 'Creating account...' : 'Create account'}
        </button>
      </form>
      <div className="divider">or</div>
      <GoogleButton onClick={() => run(signInWithGoogle)} disabled={pending} />
    </AuthCard>
  )
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  )
}
