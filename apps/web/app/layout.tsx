import './globals.css'

export const metadata = {
  title: 'Agent OS · Mission Control',
  description: 'Unified control panel for Nous Research Hermes, Claude Code, and Antigravity agents.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
