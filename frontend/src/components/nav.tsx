"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Moon, Sun, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

const links = [
  { href: "/dashboard", label: "Viajes" },
  { href: "/mantenimiento", label: "Mantenimiento" },
  { href: "/settings", label: "Empresa" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggleMode, empresa, logoUrl } = useTheme();

  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
  }

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={empresa ?? "Logo"} className="h-8 max-w-[120px] object-contain" />
          ) : (
            <Truck className="h-5 w-5 text-primary" />
          )}
          <span className="hidden sm:inline">{empresa ?? "ERP Logístico"}</span>
        </Link>
        <nav className="flex flex-1 gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent",
                pathname.startsWith(l.href) && "bg-accent text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMode}
          aria-label={mode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        >
          {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4" /> Salir
        </Button>
      </div>
    </header>
  );
}
