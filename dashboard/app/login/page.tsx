export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand"><span className="brand-mark" /> Screen Time</div>
        <p className="eyebrow">PRIVATE DASHBOARD</p>
        <h1 className="login-title">Welcome back.</h1>
        <p className="login-copy">Sign in to view today&apos;s activity.</p>
        <form className="login-form" action="/api/auth/login" method="post">
          <label htmlFor="password">Dashboard password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
          />
          {error ? <p className="login-error" role="alert">That password is incorrect. Please try again.</p> : null}
          <button type="submit">Sign in</button>
        </form>
        <small className="login-privacy">Encrypted in transit · secure session cookie</small>
      </section>
    </main>
  );
}
