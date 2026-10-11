"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  // Tras autenticar NO se redirige: se espera a que el backend de Render despierte.
  const { status, attempts } = useBackendHealth(authenticated, 5000);

  useEffect(() => {
    if (status === "online") router.replace("/dashboard");
  }, [status, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos" : error.message);
      return;
    }
    setAuthenticated(true);
  }

  if (authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <h1 className="text-xl font-semibold">Conectando al motor logístico...</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            El servidor puede tardar hasta un minuto en despertar. Te llevaremos al dashboard en cuanto esté listo.
          </p>
          {attempts > 0 && <p className="text-xs text-muted-foreground">Reintentando conexión (intento {attempts + 1})…</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Truck className="h-5 w-5" />
          </div>
          <CardTitle>ERP Logístico</CardTitle>
          <CardDescription>Inicia sesión para continuar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            {error && <Alert variant="error">{error}</Alert>}
            <div className="grid gap-2">
              <Label htmlFor="email">Correo</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
