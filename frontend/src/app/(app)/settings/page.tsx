import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="grid max-w-3xl gap-4">
      <p className="text-sm text-muted-foreground">Datos fiscales, imagen de la empresa y FIEL para la descarga masiva del SAT.</p>
      <SettingsForm />
    </div>
  );
}
