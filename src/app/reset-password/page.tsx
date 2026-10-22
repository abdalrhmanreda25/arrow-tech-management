'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import AuthCard from '@/components/AuthCard'
import Alert from '@/components/ui/Alert'
import Field from '@/components/ui/Field'
import { useAuth } from '@/components/providers/AuthProvider'
import { friendlyError } from '@/lib/errors'

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      // Do not reveal whether an account exists for this address.
      if ((err as { code?: string }).code === 'auth/user-not-found') setSent(true)
      else setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCard title="Reset password" subtitle="We will send a reset link if an account uses this email." footer={<Link className="text-link" href="/login/">Back to sign in</Link>}>
      {sent ? <Alert type="success">If an account exists for {email}, a reset link is on its way.</Alert> : null}
      {error ? <Alert type="error">{error}</Alert> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email">
          {(p) => <input {...p} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <button className="btn btn-accent btn-block" disabled={pending || !email}>
          {pending ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
    </AuthCard>
  )
}
