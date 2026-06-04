import type { Metadata } from "next";
import { GlobalHelpTooltip } from "@/components/GlobalHelpTooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Escala MD",
  description: "Automacao de escala semanal para corretores"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <GlobalHelpTooltip />
      </body>
    </html>
  );
}
