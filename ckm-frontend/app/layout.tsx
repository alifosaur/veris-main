import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        
        <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
      </head>
      <body className="bg-slate-950 text-slate-200" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}