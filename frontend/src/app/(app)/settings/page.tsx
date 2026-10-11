import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="grid max-w-2xl gap-4">
      <div>
        <h1 className="text-2xl font-bold">Configuración de empresa</h1>
        <p className="text-sm text-muted-foreground">Datos fiscales y FIEL para la descarga masiva del SAT.</p>
      </div>
      <SettingsForm />
    </div>
  );
}
