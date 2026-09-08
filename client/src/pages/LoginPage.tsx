import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema } from '@poryg/shared';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Fields';
import { focusFirstInvalid, zodFieldErrors, type FieldErrors } from '../lib/forms';

// Comptes de démonstration, affichés uniquement en développement.
// Doit rester synchronisé avec server/src/db/seed.ts.
const DEMO_PASSWORD = 'Poryg2026!';
const DEMO_ACCOUNTS = [
  { email: 'alice.martin@poryg.local', label: 'Alice · AI Officer' },
  { email: 'camille.roux@poryg.local', label: 'Camille · Application Manager' },
  { email: 'david.nguyen@poryg.local', label: 'David · DPO' },
  { email: 'emma.bernard@poryg.local', label: 'Emma · Auditeur' },
  { email: 'lucas.petit@poryg.local', label: 'Lucas · Utilisateur standard' },
];

export function LoginPage() {
  const { user, status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Connexion · Poryg'AI";
  }, []);

  useEffect(() => {
    if (globalError) alertRef.current?.focus();
  }, [globalError]);

  if (status === 'ready' && user) return <Navigate to={from} replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      // Laisse React appliquer aria-invalid avant de déplacer le focus.
      setTimeout(() => focusFirstInvalid(formRef.current), 0);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      navigate(from, { replace: true });
    } catch (error) {
      setGlobalError(error instanceof ApiError ? error.message : 'Connexion impossible pour le moment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-layout">
      <main id="main" className="login-card card">
        <img src="/logo.png" alt="" width={110} height={110} className="login-logo" />
        <p className="eyebrow mono">Registre des applications IA</p>
        <h1 className="login-title">
          Connexion à <span className="brand-text">Poryg'AI</span>
        </h1>

        {globalError && (
          <Alert tone="error" ref={alertRef}>
            {globalError}
          </Alert>
        )}

        <form ref={formRef} onSubmit={handleSubmit} noValidate className="login-form">
          <TextField
            id="email"
            label="Adresse e-mail"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
          />
          <TextField
            id="password"
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
          />
          <Button type="submit" disabled={submitting} className="login-submit">
            {submitting ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>

        <p className="login-sso muted">
          Connexion SSO d'entreprise : disponible dans une prochaine version.
        </p>

        {import.meta.env.DEV && (
          <section className="demo-accounts" aria-labelledby="demo-title">
            <h2 id="demo-title" className="demo-accounts__title mono">
              Comptes de démo (développement)
            </h2>
            <ul className="demo-accounts__list">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    className="demo-accounts__button"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(DEMO_PASSWORD);
                      setErrors({});
                    }}
                  >
                    {account.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
