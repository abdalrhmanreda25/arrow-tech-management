'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import AppShell from '@/components/AppShell'
import Onboarding from '@/components/Onboarding'
import { useAuth } from '@/components/providers/AuthProvider'
import OrgProvider, { useOrg } from '@/components/providers/OrgProvider'
import { ErrorState, FullPageSpinner } from '@/components/ui/States'

function Gate({ children }: { children: ReactNode }) {
  const { memberships, membershipsLoading, membershipsError, loading, error, orgId } = useOrg()
  if (membershipsError) {
    return (
      <main id="main" className="login-screen">
        <div className="card login-card">
          <ErrorState error={membershipsError} onRetry={() => window.location.reload()} title="Could not load your organizations" />
        </div>
      </main>
    )
  }
  if (membershipsLoading) return <FullPageSpinner label="Loading your organizations" />
  if (!memberships.length) return <Onboarding />
  if (loading || !orgId) return <FullPageSpinner label="Loading workspace" />
  return (
    <AppShell>
      {error ? <ErrorState error={error} onRetry={() => window.location.reload()} /> : children}
    </AppShell>
  )
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && !user) router.replace(`/login/?next=${encodeURIComponent(pathname)}`)
  }, [user, loading, router, pathname])

  if (loading || !user) return <FullPageSpinner />
  return (
    <OrgProvider>
      <Gate>{children}</Gate>
    </OrgProvider>
  )
}
