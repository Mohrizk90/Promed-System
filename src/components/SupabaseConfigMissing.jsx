export default function SupabaseConfigMissing() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-gray-200 p-6 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Promed — setup required</h1>
        <p className="text-sm text-gray-600 mb-4">
          Supabase is not configured. Create a <code className="text-xs bg-gray-100 px-1 rounded">.env</code> file
          in the project root with your API keys (copy from <code className="text-xs bg-gray-100 px-1 rounded">.env.example</code>).
        </p>
        <pre className="text-left text-xs bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key`}
        </pre>
        <p className="text-xs text-gray-500 mt-4">Restart the dev server after saving .env</p>
      </div>
    </div>
  )
}
