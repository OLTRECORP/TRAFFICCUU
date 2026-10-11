import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP Logístico",
  description: "Control de fletes, Carta Porte y mantenimiento de flotilla",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
