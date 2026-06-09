// Global fallback for unmatched (non-localized) routes. Self-contained (no root layout wraps it).
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', margin: 0 }}>404</h1>
          <p>
            <a href="/zh-TW" style={{ color: '#0284c7' }}>
              World Cup 2026 Analytics
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
