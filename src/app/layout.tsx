import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contatos Locais BR",
  description: "Busque contatos de empresas locais por regiao no Brasil.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
