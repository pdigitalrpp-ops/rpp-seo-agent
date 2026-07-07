"use client"
import { signIn } from "next-auth/react"
import { useState } from "react"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const [error, setError] = useState("")
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const result = await signIn("credentials", {
      username: form.get("username"),
      password: form.get("password"),
      redirect: false,
    })
    if (result?.ok) {
      router.push("/")
    } else {
      setError("Usuario o contraseña incorrectos")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl border-t-4 border-rpp-yellow shadow-md p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <span className="font-extrabold text-rpp-ink text-lg">RPP SEO Dashboard</span>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            name="username"
            placeholder="Usuario"
            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rpp-teal/30 focus:border-rpp-teal"
            required
          />
          <input
            name="password"
            type="password"
            placeholder="Contraseña"
            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rpp-teal/30 focus:border-rpp-teal"
            required
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-rpp-ink text-white rounded-full py-2 text-sm font-bold hover:bg-gray-800 transition"
          >
            Ingresar
          </button>
        </form>
      </div>
    </div>
  )
}
