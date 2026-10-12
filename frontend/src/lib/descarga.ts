/** Descarga un texto (XML) como archivo desde el navegador. */
export function descargarXml(nombre: string, xml: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre.endsWith(".xml") ? nombre : `${nombre}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}
