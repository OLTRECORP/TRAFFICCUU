"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { postBackend } from "@/lib/api";
import type { EmpresaConfig } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const MAX_FILE = 1024 * 1024; // .cer/.key pesan unos KB
const REGIMENES = [
  ["601", "601 · General de Ley Personas Morales"],
  ["603", "603 · Personas Morales con Fines no Lucrativos"],
  ["612", "612 · Personas Físicas con Actividades Empresariales"],
  ["621", "621 · Incorporación Fiscal"],
  ["625", "625 · Plataformas Tecnológicas"],
  ["626", "626 · Régimen Simplificado de Confianza"],
];

export function SettingsForm() {
  const sb = createClient();
  const [cfg, setCfg] = useState<EmpresaConfig | null>(null);
  const [rfc, setRfc] = useState("");
  const [razon, setRazon] = useState("");
  const [regimen, setRegimen] = useState("601");
  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    sb.from("empresa_configuracion")
      .select("id,user_id,rfc,razon_social,regimen_fiscal,cer_path,key_path")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else if (data) {
          setCfg(data as EmpresaConfig);
          setRfc(data.rfc); setRazon(data.razon_social); setRegimen(data.regimen_fiscal);
        }
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickFile(f: File | null, ext: ".cer" | ".key", set: (f: File | null) => void) {
    setError(null);
    if (f && !f.name.toLowerCase().endsWith(ext)) return setError(`El archivo debe ser ${ext}`);
    if (f && f.size > MAX_FILE) return setError("El archivo es demasiado grande");
    set(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setOk(false);
    const rfcN = rfc.trim().toUpperCase();
    if (!RFC_RE.test(rfcN)) return setError("RFC inválido");
    if (!razon.trim()) return setError("La razón social es obligatoria");

    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Sesión expirada");

      const base = { rfc: rfcN, razon_social: razon.trim(), regimen_fiscal: regimen };
      let id = cfg?.id;
      if (id) {
        const { error } = await sb.from("empresa_configuracion").update(base).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("empresa_configuracion").insert({ ...base, user_id: user.id }).select("id").single();
        if (error) throw error;
        id = data.id;
      }

      // FIEL -> Storage privado, carpeta = auth.uid() (política RLS de storage)
      const paths: { cer_path?: string; key_path?: string } = {};
      for (const [file, ext, field] of [[cer, "cer", "cer_path"], [key, "key", "key_path"]] as const) {
        if (!file) continue;
        const path = `${user.id}/fiel.${ext}`;
        const { error } = await sb.storage.from("fiel").upload(path, file, { upsert: true, contentType: "application/octet-stream" });
        if (error) throw error;
        paths[field] = path;
      }
      if (Object.keys(paths).length) {
        const { error } = await sb.from("empresa_configuracion").update(paths).eq("id", id!);
        if (error) throw error;
      }

      // La contraseña se cifra en el backend (Fernet); nunca se guarda en claro ni se lee desde el cliente.
      if (pass) await postBackend("empresa/password-sat", JSON.stringify({ password: pass }), "application/json");

      setCfg({ ...(cfg ?? ({} as EmpresaConfig)), id: id!, user_id: user.id, ...base, cer_path: paths.cer_path ?? cfg?.cer_path ?? null, key_path: paths.key_path ?? cfg?.key_path ?? null });
      setCer(null); setKey(null); setPass("");
      setOk(true);
    } catch (err) {
      setError((err as { message?: string }).message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      {error && <Alert variant="error">{error}</Alert>}
      {ok && <Alert variant="success">Configuración guardada.</Alert>}

      <Card>
        <CardHeader><CardTitle>Datos fiscales</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="rfc">RFC</Label>
            <Input id="rfc" value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())} maxLength={13} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="regimen">Régimen fiscal</Label>
            <select id="regimen" value={regimen} onChange={(e) => setRegimen(e.target.value)}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {REGIMENES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </select>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="razon">Razón social</Label>
            <Input id="razon" value={razon} onChange={(e) => setRazon(e.target.value)} required />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>FIEL (e.firma)</CardTitle>
          <CardDescription>Se guardan en un bucket privado. La contraseña se almacena cifrada.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cer">Certificado (.cer)</Label>
            <Input id="cer" type="file" accept=".cer" onChange={(e) => pickFile(e.target.files?.[0] ?? null, ".cer", setCer)} />
            {cfg?.cer_path && !cer && <Subido />}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="key">Llave privada (.key)</Label>
            <Input id="key" type="file" accept=".key" onChange={(e) => pickFile(e.target.files?.[0] ?? null, ".key", setKey)} />
            {cfg?.key_path && !key && <Subido />}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pass">Contraseña de la FIEL</Label>
            <Input id="pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)}
              placeholder={cfg ? "Déjala vacía para conservar la actual" : ""} />
          </div>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar configuración
        </Button>
      </div>
    </form>
  );
}

const Subido = () => (
  <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Archivo cargado</p>
);
