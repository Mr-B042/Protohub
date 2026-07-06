import { useEffect, useState } from "react";
import { authApi } from "../lib/api";
import { auth } from "../lib/auth";

interface Props {
  onDone: () => void;
}

// Lands here from the Supabase recovery email. The email link redirects to
// `${FRONTEND_URL}/#/reset-password#access_token=...&refresh_token=...&type=recovery`.
// We pull the recovery JWT out of the URL fragment, store it via auth.save, and
// then call /api/auth/set-password (which uses requireAuth - Supabase recovery
// tokens are valid Bearer tokens). On success, send the user to /login.
export function ResetPasswordScreen({ onDone }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [show, setShow]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    // The hash looks like "#/reset-password#access_token=…&refresh_token=…&type=recovery"
    // (Supabase uses a fragment). Find the inner fragment and parse it.
    const raw = window.location.hash;
    const innerStart = raw.indexOf("#", 1);
    const fragment = innerStart >= 0 ? raw.slice(innerStart + 1) : raw.slice(1);
    const params = new URLSearchParams(fragment);
    const accessToken  = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type         = params.get("type");

    if (type === "recovery" && accessToken && refreshToken) {
      // We don't yet have a user profile - set-password resolves the user from the JWT.
      auth.save(accessToken, refreshToken, {
        id: "", orgId: "", name: "", email: "", role: ""
      });
      setTokenReady(true);
    } else {
      setError("Invalid or expired reset link. Request a new one from the sign-in page.");
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      await authApi.setPassword(password);
      // Force a clean re-login: clear the recovery session and bounce to /login.
      auth.clear();
      setSuccess("Password updated. Please sign in with your new password.");
      setTimeout(() => {
        window.location.hash = "";
        onDone();
      }, 1200);
    } catch (err: any) {
      setError(err?.message ?? "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F8FE0] mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set a new password</h1>
          <p className="text-sm text-gray-500 mt-1">Choose something at least 8 characters.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {success && <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700 font-medium">{success}</div>}
          {error   && <div className="mb-4 p-3 rounded-lg bg-red-50   border border-red-200   text-sm text-red-700   font-medium">{error}</div>}

          {tokenReady && !success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">New password</label>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    required minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full px-3 py-2.5 pr-16 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                  />
                  <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#1F8FE0]">
                    {show ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Confirm new password</label>
                <input
                  type={show ? "text" : "password"}
                  required minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full py-2.5 px-4 bg-[#1F8FE0] hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
              >
                {loading ? "Saving…" : "Update password"}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => { auth.clear(); window.location.hash = ""; onDone(); }}
            className="w-full py-2 mt-3 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
}
