import Link from 'next/link'

export default function NotFound() {
  return (
    <main id="main" className="login-screen">
      <div className="card login-card">
        <h1>Page not found</h1>
        <p className="muted">That page does not exist in the Arrow Tech dashboard.</p>
        <Link href="/dashboard/" className="btn btn-primary btn-block" style={{ marginTop: 24 }}>
          Go to dashboard
        </Link>
      </div>
    </main>
  )
}
