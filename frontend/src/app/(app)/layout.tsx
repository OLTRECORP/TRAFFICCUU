import { Sidebar, Topbar } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  );
}
