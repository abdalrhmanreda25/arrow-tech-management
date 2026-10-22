import type { ReactNode } from 'react'
import Link from 'next/link'

/** Centered card used by every signed-out screen, matching the site's admin login. */
export default function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main id="main" className="login-screen">
      <div className="card login-card">
        <div className="login-header">
          <Link href="/" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" width={28} height={28} />
            <span>
              Arrow <span>Tech</span>
            </span>
          </Link>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {children}
        {footer ? <div className="login-footer">{footer}</div> : null}
      </div>
    </main>
  )
}
