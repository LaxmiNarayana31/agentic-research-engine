import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Project 1: Multi-Agent Research System',
  description: 'Enterprise Multi-Agent Research System Live Trace View',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen">
        {children}
      </body>
    </html>
  )
}
