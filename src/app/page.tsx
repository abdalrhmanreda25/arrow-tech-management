'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthProvider'
import { FullPageSpinner } from '@/components/ui/States'

export default function Home() {
  const { user, loading } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!loading) router.replace(user ? '/dashboard/' : '/login/')
  }, [user, loading, router])
  return <FullPageSpinner />
}
