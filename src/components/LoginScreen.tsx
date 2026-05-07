import { useState } from "react";
import { authApi } from "../lib/api";
import { auth } from "../lib/auth";

interface Props {
  onLogin: () => void;
}

type Mode = "login" | "register" | "forgot";

export function LoginScreen({ onLogin }: Props) {
  const [mode, setMode]       = useState<Mode>("login");
  const [orgName, setOrgName] = useState("");
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await authApi.login(email, password);
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
    setError(""); setLoading(true);
    try {
      await authApi.register({ orgName, name, email, password });
      setSuccess("Account created! You can now sign in.");
      setMode("login");
      setOrgName(""); setName("");
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
      setSuccess("If that email is registered, a reset link has been sent. Check your inbox.");
      setMode("login");
    } catch (err: any) {
      // Always show success to not leak whether email is registered
      setSuccess("If that email is registered, a reset link has been sent. Check your inbox.");
      setMode("login");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => { setMode(m); setError(""); setSuccess(""); };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F8FE0] mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">ProtoHub CRM</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === "login" ? "Sign in to your workspace" : mode === "register" ? "Create your organization" : "Reset your password"}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {mode !== "forgot" && (
            <div className="flex rounded-xl bg-gray-100 p-1 mb-6">
              {(["login", "register"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors capitalize ${
                    mode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {m === "login" ? "Sign In" : "Register"}
                </button>
              ))}
            </div>
          )}

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
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "Min. 8 characters" : "••••••••"}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1F8FE0] focus:border-transparent"
                />
              </div>

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
