import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { SESSION_DAYS } from "./access"
import { AccessError, verifyCode } from "./accessServer"

/**
 * Configuración de next-auth. Vive aquí y no en la ruta porque el layout la
 * necesita para getServerSession, y una ruta del App Router no puede exportar
 * nada más que sus handlers.
 *
 * Reemplaza al login anterior de 3 usuarios con contraseña compartida
 * (PASS_EDITORIAL/DIRECCION/ADMIN), que además no protegía nada: ninguna página
 * exigía sesión. Ahora lo hace middleware.ts.
 */
const SESSION_MAX_AGE_S = SESSION_DAYS * 24 * 60 * 60

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: "email-code",
      name: "Código por correo",
      credentials: {
        email: { label: "Correo", type: "email" },
        code:  { label: "Código", type: "text" },
      },
      async authorize(credentials) {
        try {
          const email = await verifyCode(credentials?.email, credentials?.code)
          return { id: email, email, name: email }
        } catch (e) {
          // next-auth devuelve el mensaje del error al cliente como `error`.
          throw new Error(e instanceof AccessError ? e.message : "No se pudo verificar el código.")
        }
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
  jwt: { maxAge: SESSION_MAX_AGE_S },
  callbacks: {
    // `loginAt` fija el vencimiento a 30 días desde el INGRESO. El maxAge de
    // next-auth solo no basta: la cookie JWT se re-emite al usarse y el plazo
    // se correría indefinidamente. El middleware compara contra loginAt.
    async jwt({ token, user }) {
      if (user) token.loginAt = Date.now()
      return token
    },
    async session({ session, token }) {
      if (session.user) session.user.email = token.email ?? session.user.email
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
}
