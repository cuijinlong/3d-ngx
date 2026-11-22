import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthSession } from "../../auth/AuthSession";
import { postLoginPath } from "../../auth/access";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { loginFailureMessage, loginMissingMessage } from "./login-card-message";
import styles from "./LoginPage.module.css";

export function LoginPage() {
  const { login } = useAuthSession();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const missing = loginMissingMessage(username, password);
    if (missing) {
      setError(missing);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const session = await login(username.trim(), password);
      nav(postLoginPath(session.authority, session.customerId), { replace: true });
    } catch (err) {
      setError(loginFailureMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.stage}>
      <div className={styles.grid} />
      <svg className={styles.schematic} viewBox="0 0 980 740" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35">
          <rect x="520" y="210" width="86" height="220" rx="6" />
          <rect x="630" y="210" width="86" height="220" rx="6" />
          <rect x="740" y="210" width="86" height="220" rx="6" />
          <rect x="535" y="248" width="56" height="28" rx="3" />
          <rect x="645" y="248" width="56" height="28" rx="3" />
          <rect x="755" y="248" width="56" height="28" rx="3" />
          <path d="M563 430 V500 H820 V430" />
          <path d="M673 430 V500" />
          <circle cx="563" cy="500" r="7" />
          <circle cx="673" cy="500" r="7" />
          <circle cx="783" cy="500" r="7" />
          <path d="M820 500 H900 V320 H840" />
          <rect x="820" y="286" width="84" height="48" rx="6" />
          <path d="M520 250 H430 V140 H300" />
          <rect x="214" y="108" width="110" height="86" rx="8" />
          <path d="M269 194 V260 H360" />
          <rect x="348" y="244" width="70" height="44" rx="6" />
          <path d="M214 151 H160 V400 H300" />
          <path d="M160 400 C160 470 250 500 360 500" />
          <circle cx="300" cy="400" r="7" />
          <path d="M430 140 H480" />
          <rect x="470" y="116" width="64" height="48" rx="6" />
          <path d="M740 250 H880 V180" />
          <circle cx="880" cy="180" r="8" />
          <path d="M563 210 V170 H740 V210" />
        </g>
      </svg>
      <div className={styles.theme}>
        <ThemeToggle />
      </div>
      <form className={styles.card} noValidate onSubmit={(event) => void onSubmit(event)}>
        <div className={styles.brandRow}>
          <span className={styles.mark} />
          <div className={styles.brand}>3D-NGX</div>
        </div>
        <div className={styles.field}>
          <label htmlFor="ngx-login-username">账号</label>
          <input
            id="ngx-login-username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="ngx-login-password">密码</label>
          <input
            id="ngx-login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? "登录中…" : "登录"}
        </button>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <div className={styles.hint}>请使用与平台相同的账号</div>
      </form>
    </div>
  );
}
