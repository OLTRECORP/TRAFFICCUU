import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/theme-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </ThemeProvider>
  );
}
