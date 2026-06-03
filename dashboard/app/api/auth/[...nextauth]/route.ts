import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Usuario",    type: "text" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const users = [
          { id: "1", name: "Editorial RPP", username: "editorial", password: process.env.PASS_EDITORIAL },
          { id: "2", name: "Dirección RPP", username: "direccion", password: process.env.PASS_DIRECCION },
          { id: "3", name: "Admin",         username: "admin",     password: process.env.PASS_ADMIN },
        ]
        const user = users.find(
          u => u.username === credentials?.username && u.password === credentials?.password
        )
        return user ?? null
      },
    }),
  ],
  pages:   { signIn: "/login" },
  session: { strategy: "jwt" },
  secret:  process.env.NEXTAUTH_SECRET,
})

export { handler as GET, handler as POST }
