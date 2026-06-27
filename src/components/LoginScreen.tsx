import { useState } from "react";
import { authApi } from "../lib/api";
import { auth } from "../lib/auth";

interface Props {
  onLogin: () => void;
}

type Mode = "login" | "register" | "forgot";
const LOGIN_TIMEOUT_MS = 15000;

async function withLoginTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Login is taking too long. Please check your connection and try again.")),
          LOGIN_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function passwordStrength(pw: string): { label: string; pct: number; color: string } {
  if (!pw) return { label: "", pct: 0, color: "" };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const buckets: Array<{ label: string; color: string }> = [
    { label: "Too weak",  color: "bg-red-500" },
    { label: "Weak",      color: "bg-orange-500" },
    { label: "Fair",      color: "bg-yellow-500" },
    { label: "Good",      color: "bg-lime-500" },
    { label: "Strong",    color: "bg-green-500" },
    { label: "Very strong", color: "bg-emerald-600" }
  ];
  const b = buckets[score];
  return { label: b.label, pct: ((score) / (buckets.length - 1)) * 100, color: b.color };
}

// Read a value the app persists via writeStored (JSON-encoded). The login
// screen shows the last-known org brand from a previous session so the
// workspace looks consistent before sign-in (falls back to ProtoHub default
// on a fresh device).
function readStoredString(key: string): string {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return "";
    try { const v = JSON.parse(raw); return typeof v === "string" ? v : ""; }
    catch { return raw; }
  } catch { return ""; }
}

// Local sandbox vs live prod. The REAL bundled company logo is only used as
// the default on prod — on localhost we fall back to the generic cube so the
// two environments are instantly distinguishable at a glance.
const IS_LOCAL_HOST =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(window.location.hostname);

export function LoginScreen({ onLogin }: Props) {
  const [mode, setMode]       = useState<Mode>("login");
  const brandName = readStoredString("protohub.companyName").trim();
  const brandLogo = readStoredString("protohub.companyLogo").trim();
  // Prod default = real company logo; local default = none (→ cube fallback).
  const defaultBrandLogo = IS_LOCAL_HOST ? "" : "/brand/company-logo.png";
  const loginLogoSrc = brandLogo || defaultBrandLogo;
  const [brandLogoBroken, setBrandLogoBroken] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await withLoginTimeout(authApi.login(email, password));
      auth.save(data.accessToken, data.refreshToken, {
        id:    data.user.id,
        orgId: data.user.orgId,
        name:  data.user.name,
        email: data.user.email,
        role:  data.user.role
      });
      onLogin();
    } catch (err: any) {
      setError(err.message ?? "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      await authApi.register({ orgName, name, email, password });
      setSuccess("Account created! You can now sign in.");
      setMode("login");
      setOrgName(""); setName(""); setPassword(""); setConfirmPassword("");
    } catch (err: any) {
      setError(err.message ?? "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await authApi.resetPassword(email);
      // Backend deliberately returns 200 regardless of email existence —
      // we only reach this branch on a successful HTTP response.
      setSuccess("If that email is registered, a reset link has been sent. Check your inbox.");
      setMode("login");
    } catch (err: any) {
      // Real failure (network, 5xx, rate-limit). Surface the error so the
      // user knows the request didn't go through — earlier code silently
      // swallowed this as success and the user would never get an email.
      setError(err?.message ?? "Could not send reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => { setMode(m); setError(""); setSuccess(""); setConfirmPassword(""); };
  const strength = passwordStrength(password);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / brand — the org's saved logo if present, else the bundled
            company logo. Falls back to the ProtoHub mark only if both fail. */}
        <div className="text-center mb-8">
          {loginLogoSrc && !brandLogoBroken ? (
            <img
              src={loginLogoSrc}
              alt={brandName || "Protohub"}
              onError={() => setBrandLogoBroken(true)}
              className="inline-block h-24 w-auto max-w-[240px] object-contain rounded-2xl mb-4"
            />
          ) : (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F8FE0] mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          )}
          <p className="text-sm text-gray-500 mt-1">
            {mode === "login" ? "Sign in to your workspace" : mode === "register" ? "Create your organization" : "Reset your password"}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {/* Public self-registration is disabled — this is a private workspace.
              New users are added by the Owner/Admin in User Management, so the
              login screen is sign-in only (plus password reset). */}

          {success && (
            <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700 font-medium">
              {success}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 font-medium">
              {error}
            </div>
          )}

          {mode === "forgot" ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-[#1F8FE0] hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Back to Sign In
              </button>
            </form>
          ) : (
            <form onSubmit={mode === "login" ? handleLogin : handleRegister} className="space-y-4">
              {mode === "register" && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Organization Name</label>
                    <input
                      type="text"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="e.g. Bright POD Store"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Your Full Name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Busy Bright"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-semibold text-gray-700">Password</label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs text-[#1F8FE0] hover:underline font-medium"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "register" ? "Min. 8 characters" : "••••••••"}
                    className="w-full px-3 py-2.5 pr-16 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#1F8FE0]"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {mode === "register" && password.length > 0 && (
                  <div className="mt-1.5">
                    <div className="h-1 w-full rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full transition-all ${strength.color}`} style={{ width: `${strength.pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{strength.label}</p>
                  </div>
                )}
              </div>

              {mode === "register" && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Confirm Password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                  />
                  {confirmPassword.length > 0 && confirmPassword !== password && (
                    <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-[#1F8FE0] hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
              >
                {loading
                  ? (mode === "login" ? "Signing in…" : "Creating account…")
                  : (mode === "login" ? "Sign In" : "Create Account")}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          ProtoHub CRM &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
