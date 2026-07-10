import "./globals.css";

export const metadata = {
  title: "IA40 Dashboard - Cobus Group",
  description: "Evolucion mensual de posiciones arancelarias por categoria",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
