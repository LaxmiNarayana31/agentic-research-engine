import type { Metadata } from 'next'
import { Manrope, Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { AuthProvider } from './context/AuthContext'

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Deep Research AI',
  description: 'Autonomous multi-agent deep research and intelligence engine.',
  icons: {
    icon: [
      { url: '/icon.svg?v=2', type: 'image/svg+xml' }
    ],
    shortcut: '/icon.svg?v=2',
    apple: '/icon.svg?v=2',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${inter.variable}`}>
      <body className="bg-slate-950 text-slate-100 min-h-screen font-sans">
        <Script src="https://accounts.google.com/gsi/client" strategy="lazyOnload" />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
