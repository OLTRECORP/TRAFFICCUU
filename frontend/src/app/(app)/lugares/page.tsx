"use client";

import { LugaresPanel } from "@/components/lugares-panel";
import { RutasPanel } from "@/components/rutas-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LugaresPage() {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Orígenes y destinos con su ubicación en el mapa. La distancia por carretera entre ellos se usa para calcular los km operativos de cada viaje (ida x 2).
      </p>
      <Tabs defaultValue="lugares">
        <TabsList>
          <TabsTrigger value="lugares">Lugares</TabsTrigger>
          <TabsTrigger value="rutas">Distancias</TabsTrigger>
        </TabsList>
        <TabsContent value="lugares"><LugaresPanel /></TabsContent>
        <TabsContent value="rutas"><RutasPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
