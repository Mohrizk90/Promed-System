import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { Mail, Lock, Eye, EyeOff, LogIn, Spinner } from '../ui/Icons'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})

  const { signIn, resetPassword } = useAuth()
  const { success, error: showError } = useToast()
  const navigate = useNavigate()
  const [showResetForm, setShowResetForm] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)

  const validate = () => {
    const newErrors = {}
    if (!email) {
      newErrors.email = 'Email is required'
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Invalid email address'
    }
    if (!password) {
      newErrors.password = 'Password is required'
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      const { error } = await signIn(email, password)
      if (error) throw error

      success('Welcome back!')
      navigate('/dashboard')
    } catch (err) {
      showError(err.message || 'Failed to sign in')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    if (!resetEmail || !/\S+@\S+\.\S+/.test(resetEmail)) {
      showError('Please enter a valid email address')
      return
    }
    setLoading(true)
    try {
      const { error } = await resetPassword(resetEmail)
      if (error) throw error
      setResetSent(true)
      success('Check your email for the password reset link')
    } catch (err) {
      showError(err.message || 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4 pt-safe pb-safe">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-blue-600 dark:text-blue-400 mb-2">Promed</h1>
          <p className="text-gray-600 dark:text-gray-400">Transaction Management System</p>
        </div>

        {/* Form Card */}
        <div className="card p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6 text-center">
            Sign In
          </h2>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
            Use the credentials configured in your Supabase project.
          </p>

          {showResetForm ? (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
              <form onSubmit={handleResetPassword} className="space-y-5">
                <div>
                  <label className="label">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="input pl-10"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading} className="btn btn-primary w-full py-3">
                  {loading ? <Spinner size="sm" /> : 'Send reset link'}
                </button>
                {resetSent && (
                  <p className="text-sm text-green-600 dark:text-green-400 text-center">Check your email and then <button type="button" onClick={() => { setShowResetForm(false); setResetSent(false) }} className="underline">back to sign in</button>.</p>
                )}
              </form>
              {!resetSent && (
                <button type="button" onClick={() => setShowResetForm(false)} className="mt-4 w-full text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-400">
                  Back to sign in
                </button>
              )}
            </>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`input pl-10 ${errors.email ? 'input-error' : ''}`}
                  placeholder="you@example.com"
                />
              </div>
              {errors.email && (
                <p className="mt-1 text-sm text-red-500">{errors.email}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`input pl-10 pr-10 ${errors.password ? 'input-error' : ''}`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-500">{errors.password}</p>
              )}
              <button type="button" onClick={() => setShowResetForm(true)} className="mt-1 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3"
            >
              {loading ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <LogIn size={20} />
                  Sign In
                </>
              )}
            </button>
          </form>
          )}
        </div>
      </div>
    </div>
  )
}
