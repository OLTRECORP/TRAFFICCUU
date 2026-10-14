"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FileText, LayoutDashboard, LogOut, ReceiptText, Users, Container, MapPin, Moon, Settings, Sun, Truck, Wrench, Percent, Fuel, Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

const links = [
  { href: "/dashboard", label: "Dashboard", title: "Dashboard", icon: LayoutDashboard },
  { href: "/facturas", label: "Facturas", title: "Lista de facturas", icon: FileText },
  { href: "/ordenes", label: "Órdenes de compra", title: "Relación de órdenes de compra", icon: ReceiptText },
  { href: "/clientes", label: "Clientes", title: "Clientes, tarifas y facturas semanales", icon: Building2 },
  { href: "/lugares", label: "Orígenes y destinos", title: "Orígenes y destinos", icon: MapPin },
  { href: "/choferes", label: "Choferes", title: "Choferes", icon: Users },
  { href: "/comisiones", label: "Comisiones", title: "Comisiones de choferes", icon: Percent },
  { href: "/unidades", label: "Tractos y góndolas", title: "Tractos y góndolas", icon: Container },
  { href: "/mantenimiento", label: "Mantenimiento", title: "Mantenimiento", icon: Wrench },
  { href: "/combustible", label: "Combustible", title: "Combustible y rendimiento", icon: Fuel },
  { href: "/settings", label: "Empresa", title: "Configuración de empresa", icon: Settings },
];

function Brand() {
  const { logoUrl, empresa } = useTheme();
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-5 py-5">
      {logoUrl ? (
        // El logo va sobre una "pastilla" clara para verse bien con cualquier color de barra.
        <span className="flex h-12 w-full max-w-[180px] items-center justify-center rounded-2xl bg-white px-2 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt={empresa ?? "Logo"} className="max-h-full max-w-full object-contain" />
        </span>
      ) : (
        <span className="flex items-center gap-2 text-lg font-bold text-sidebar-foreground">
          <Truck className="h-6 w-6 text-highlight" /> ERP Logístico
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-3 m-3 mr-0 hidden h-[calc(100vh-1.5rem)] w-60 shrink-0 flex-col overflow-y-auto rounded-3xl bg-sidebar text-sidebar-foreground shadow-lg md:flex">
      <Brand />
      <nav className="mt-2 grid gap-1 px-3" aria-label="Principal">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-white/10 hover:text-sidebar-foreground",
                active && "bg-white/15 text-sidebar-foreground shadow-sm",
              )}
            >
                            <Icon className={cn("h-[18px] w-[18px]", active && "text-highlight")} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const { mode, toggleMode, empresa } = useTheme();
  const [email, setEmail] = useState<string>("");
  const title = links.find((l) => pathname.startsWith(l.href))?.title ?? "ERP Logístico";

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function logout() {
    try {
      await createClient().auth.signOut({ scope: "local" });
    } finally {
      // Recarga completa: limpia caché del router y estado en memoria; el middleware ya no ve sesión.
      window.location.assign("/login");
    }
  }

  const initial = (empresa ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";
  const iconBtn = "flex h-9 w-9 items-center justify-center rounded-full text-sidebar-foreground/85 hover:bg-white/10";

  return (
    <header className="m-3 mb-0 rounded-3xl bg-sidebar text-sidebar-foreground shadow-lg md:ml-3">
      <div className="flex h-14 items-center gap-3 px-5 md:px-6">
        <h1 className="flex-1 text-base font-semibold">{title}</h1>
        <button onClick={toggleMode} className={iconBtn} aria-label={mode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}>
          {mode === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-highlight text-sm font-bold text-white">{initial}</span>
          <div className="hidden text-left leading-tight sm:block">
            <p className="max-w-[180px] truncate text-sm font-medium">{empresa ?? "Mi empresa"}</p>
            <p className="max-w-[180px] truncate text-xs text-sidebar-foreground/65">{email}</p>
          </div>
        </div>
        <button onClick={logout} className={iconBtn} aria-label="Cerrar sesión">
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
      {/* Navegación compacta en móvil */}
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden" aria-label="Principal móvil">
        {links.map(({ href, label }) => (
          <Link key={href} href={href}
            className={cn("rounded-full px-3 py-1.5 text-sm text-sidebar-foreground/75", pathname.startsWith(href) && "bg-white/10 text-sidebar-foreground")}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
