// Ejecutar: npm test  (Node >= 22.18: ejecuta .ts directamente)
import test from "node:test";
import assert from "node:assert/strict";
import { resumenPorChofer, semanaPago, semanaPagoDesplazada, estadisticas, etiquetaSemanaPago } from "../src/lib/comisiones.ts";
import { tramos, cargasPorDia, rendimientoPorChofer } from "../src/lib/combustible.ts";

// ---- Comisiones: semana de pago vie–jue --------------------------------------------------
test("viernes inicia la semana y jueves la cierra; se paga el viernes siguiente", () => {
  assert.deepEqual(semanaPago("2026-10-09"), { desde: "2026-10-09", hasta: "2026-10-15", pago: "2026-10-16" }); // viernes
  assert.deepEqual(semanaPago("2026-10-15"), { desde: "2026-10-09", hasta: "2026-10-15", pago: "2026-10-16" }); // jueves
  assert.deepEqual(semanaPago("2026-10-14"), { desde: "2026-10-09", hasta: "2026-10-15", pago: "2026-10-16" }); // miércoles
  assert.equal(semanaPago("2026-10-16").desde, "2026-10-16");                                                  // el viernes de pago abre la siguiente
});

test("sábado y domingo caen en la semana que inició el viernes anterior", () => {
  assert.equal(semanaPago("2026-10-10").desde, "2026-10-09");
  assert.equal(semanaPago("2026-10-11").desde, "2026-10-09");
});

test("desplazar semanas y cruce de año", () => {
  assert.equal(semanaPagoDesplazada("2026-10-14", -1).desde, "2026-10-02");
  assert.equal(semanaPagoDesplazada("2026-10-14", 1).desde, "2026-10-16");
  assert.deepEqual(semanaPago("2026-01-01"), { desde: "2025-12-26", hasta: "2026-01-01", pago: "2026-01-02" });
});

test("etiqueta legible", () => {
  assert.equal(etiquetaSemanaPago(semanaPago("2026-10-14")), "vie 9 oct – jue 15 oct 2026 · pago vie 16 oct");
});

test("estadísticas por semana agrupan vie–jue", () => {
  const v = (fecha, subtotal) => ({ viaje_id: fecha + subtotal, chofer_id: "c", folio: null, fecha_viaje: fecha, subtotal, origen: null, destino: null, cliente: null });
  const filas = estadisticas([v("2026-10-08", 1000), v("2026-10-09", 1000), v("2026-10-15", 1000), v("2026-10-16", 1000)], "semana");
  assert.deepEqual(filas.map((f) => [f.clave, f.viajes]), [["2026-10-16", 1], ["2026-10-09", 2], ["2026-10-02", 1]]);   // más reciente primero
  assert.equal(filas[1].comision, 240);            // 12 % de 2000 (viernes 9 y jueves 15 en la misma semana)
});

// ---- Combustible: cargas del mismo día se suman ---------------------------------------------
const carga = (id, fecha, litros, tracto = "T1") => ({ id, empresa_id: "e", tracto_id: tracto, chofer_id: "c1", fecha, litros, costo: litros ? litros * 25 : null, kilometraje: null, estacion: null, notas: null });
const viaje = (fecha_viaje, km, tracto = "T1") => ({ viaje_id: fecha_viaje + km, chofer_id: "c1", tracto_id: tracto, fecha_viaje, km });

test("dos cargas el mismo día se suman a ese día", () => {
  const dias = cargasPorDia([carga("a", "2026-10-05", 200), carga("b", "2026-10-05", 100), carga("c", "2026-10-07", 50)]);
  assert.equal(dias.length, 2);
  assert.equal(dias[0].litros, 300);
  assert.equal(dias[0].cargas.length, 2);
});

test("el tramo usa la suma del día de cierre y los km hasta ese día", () => {
  const cargas = [carga("a", "2026-10-01", 400), carga("b", "2026-10-05", 200), carga("c", "2026-10-05", 100)];
  const viajes = [viaje("2026-10-02", 500), viaje("2026-10-05", 300), viaje("2026-10-06", 999)];
  const t = tramos(cargas, viajes);
  assert.equal(t.length, 1);                       // antes: la 2.ª carga del día se perdía
  assert.equal(t[0].litros, 300);
  assert.equal(t[0].cargas, 2);
  assert.equal(t[0].km, 800);                      // viajes > 1 oct y <= 5 oct; el del 6 oct es del siguiente tramo
  assert.equal(t[0].km / t[0].litros, 800 / 300);
});

test("el siguiente tramo arranca el día de la carga múltiple", () => {
  const cargas = [carga("a", "2026-10-01", 400), carga("b", "2026-10-05", 200), carga("c", "2026-10-05", 100), carga("d", "2026-10-09", 350)];
  const viajes = [viaje("2026-10-06", 600), viaje("2026-10-08", 400)];
  const t = tramos(cargas, viajes).sort((x, y) => x.hasta.localeCompare(y.hasta));
  assert.equal(t.length, 2);
  assert.equal(t[1].desde, "2026-10-05");
  assert.equal(t[1].km, 1000);
  assert.equal(t[1].litros, 350);
});

test("día con cargas sin litros: suma solo las que tienen; si ninguna, null", () => {
  assert.equal(cargasPorDia([carga("a", "2026-10-05", 120), carga("b", "2026-10-05", null)])[0].litros, 120);
  assert.equal(cargasPorDia([carga("a", "2026-10-05", null), carga("b", "2026-10-05", null)])[0].litros, null);
});

// ---- Comisiones: lo contabilizado en el detalle ---------------------------------------------
import { contabilizados } from "../src/lib/comisiones.ts";

test("contabilizados: viajes, facturas distintas, subtotal y comisión", () => {
  const v = (id, folio, subtotal) => ({ viaje_id: id, chofer_id: "c", folio, fecha_viaje: "2026-10-09", subtotal, origen: null, destino: null, cliente: null });
  const c = contabilizados([v("1", "A1", 1000), v("2", "A1", 500), v("3", "A2", 2000), v("4", null, 100)]);
  assert.deepEqual(c, { viajes: 4, facturas: 3, subtotal: 3600, comision: 432 });   // A1 con 2 viajes cuenta 1 factura; sin folio cuenta aparte
});

// ---- Comisiones: tasa por viaje (cliente o ruta) -------------------------------------------------------------
import { comisionViaje, etiquetaTasas, totales } from "../src/lib/comisiones.ts";

test("cada viaje usa su tasa: Purísima 11 %, ruta Rumorosa→Venados 10 %, sin dato 12 %", () => {
  const v = (subtotal, tasa_comision) => ({ viaje_id: String(subtotal) + tasa_comision, chofer_id: "c", folio: null, fecha_viaje: "2026-10-09", subtotal, origen: null, destino: null, cliente: null, tasa_comision });
  assert.equal(comisionViaje(v(5120, 11)), 563.2);
  assert.equal(comisionViaje(v(12640, 10)), 1264);
  assert.equal(comisionViaje(v(1000, null)), 120);
  const t = totales([v(5120, 11), v(12640, 10), v(1000, null)]);
  assert.equal(t.comision, 1947.2);
  assert.equal(etiquetaTasas([v(1, 11), v(1, 10)]), "10–11 %");
  assert.equal(etiquetaTasas([v(1, 11)]), "11 %");
});

test("rendimiento: todos los viajes del chofer entran, también los previos a su primera carga y los de choferes sin cargas", () => {
  const cargas = [carga("a", "2026-10-05", 400), carga("b", "2026-10-09", 200)];
  const viajes = [viaje("2026-09-01", 100), viaje("2026-10-07", 300), viaje("2026-10-20", 50),
    { viaje_id: "x", chofer_id: "c2", tracto_id: "T2", fecha_viaje: "2026-10-08", km: 700 }];
  const filas = rendimientoPorChofer(cargas, viajes, "", "");
  const c1 = filas.find((f) => f.choferId === "c1"), c2 = filas.find((f) => f.choferId === "c2");
  assert.equal(c1.km, 300);                       // entre cargas: solo el del 7 oct
  assert.equal(c1.kmViajes, 450);                 // todos sus viajes, del más antiguo al más nuevo
  assert.equal(c1.viajes, 3);
  assert.equal(c2.kmViajes, 700);                 // sin cargas, pero su viaje cuenta
});

// ---- Ganancia por tracto / chofer ---------------------------------------------------------
import { gananciaPorTracto, gananciaPorChofer } from "../src/lib/ganancia.ts";

const gv = (id, chofer, tracto, fecha, subtotal, tasa) => ({ viaje_id: id, chofer_id: chofer, tracto_id: tracto, fecha_viaje: fecha, subtotal, tasa_comision: tasa });
const gc = (id, tracto, chofer, fecha, costo) => ({ id, empresa_id: "e", tracto_id: tracto, chofer_id: chofer, fecha, litros: 100, costo, kilometraje: null, estacion: null, notas: null });

test("ganancia por tracto = facturación − combustible − mantenimiento − comisiones, solo del año", () => {
  const viajes = [gv("1", "A", "T1", "2026-03-01", 10000), gv("2", "A", "T1", "2026-04-01", 5000, 10), gv("3", "A", "T1", "2025-12-31", 99999)];
  const cargas = [gc("c1", "T1", "A", "2026-03-02", 3000), gc("c2", "T1", "A", "2026-05-02", null), gc("c3", "T1", "A", "2025-01-01", 777)];
  const servicios = [{ tracto_id: "T1", fecha: "2026-06-01", costo: 1000 }, { tracto_id: "T1", fecha: "2025-06-01", costo: 500 }];
  const [f] = gananciaPorTracto(viajes, cargas, servicios, 2026);
  assert.equal(f.facturacion, 15000);
  assert.equal(f.comisiones, 1200 + 500);   // 12 % de 10000 (tasa general) + 10 % de 5000
  assert.equal(f.combustible, 3000);
  assert.equal(f.cargasSinCosto, 1);
  assert.equal(f.mantenimiento, 1000);
  assert.equal(f.ganancia, 15000 - 3000 - 1000 - 1700);
});

test("ganancia por chofer prorratea el mantenimiento del tracto por facturación", () => {
  const viajes = [gv("1", "A", "T1", "2026-03-01", 7500), gv("2", "B", "T1", "2026-03-02", 2500)];
  const cargas = [gc("c1", "T1", "B", "2026-03-02", 400)];
  const servicios = [{ tracto_id: "T1", fecha: "2026-06-01", costo: 1000 }];
  const r = Object.fromEntries(gananciaPorChofer(viajes, cargas, servicios, 2026).map((f) => [f.id, f]));
  assert.equal(r.A.mantenimiento, 750);
  assert.equal(r.B.mantenimiento, 250);
  assert.equal(r.B.combustible, 400);
  assert.equal(r.A.ganancia, 7500 - 750 - 900);
  assert.equal(r.B.ganancia, 2500 - 250 - 400 - 300);
});

// ---- Mantenimiento: servicios programados por km y/o días ----------------------------------------------------
import { calcularAlertas, peorNivel, textoRestante } from "../src/lib/mantenimiento.ts";

test("cada regla cuenta desde su último servicio; km y días, el peor manda", () => {
  const tracto = { id: "t1", empresa_id: "e", placa: "X", modelo: null, kilometraje_inicial: 100000, kilometraje_actual: 148500 };
  const reglas = [
    { id: "aceite", tipo_servicio: "Aceite", intervalo_km: 20000, intervalo_dias: 180, categoria: "motor" },
    { id: "afinacion", tipo_servicio: "Afinación", intervalo_km: 60000, intervalo_dias: null, categoria: "motor" },
    { id: "balatas", tipo_servicio: "Balatas", intervalo_km: 60000, intervalo_dias: null, categoria: "frenos" },
    { id: "verif", tipo_servicio: "Verificación", intervalo_km: null, intervalo_dias: 365, categoria: "otro" },
  ];
  const servicios = [
    { id: "s1", empresa_id: "e", tracto_id: "t1", gondola_id: null, fecha: "2026-05-01", kilometraje: 130000, servicio: "Cambio de aceite", categoria: "motor", costo: 0, notas: null, regla_id: "aceite" },
    { id: "s2", empresa_id: "e", tracto_id: "t1", gondola_id: null, fecha: "2026-06-01", kilometraje: 135000, servicio: "Balatas traseras", categoria: "frenos", costo: 0, notas: null, regla_id: null },
    { id: "s3", empresa_id: "e", tracto_id: "t1", gondola_id: null, fecha: "2026-07-01", kilometraje: 140000, servicio: "Revisión motor", categoria: "motor", costo: 0, notas: null, regla_id: null },
  ];
  const [aceite, afinacion, balatas, verif] = calcularAlertas(tracto, reglas, [], servicios, "2026-10-20");
  assert.equal(aceite.km.usado, 18500);                 // 148,500 − 130,000
  assert.equal(aceite.km.nivel, "amarillo");            // 92.5 %
  assert.equal(aceite.dias.usado, 172);                 // 1 may → 20 oct
  assert.equal(aceite.dias.nivel, "amarillo");          // 95.6 %
  assert.equal(aceite.nivel, "amarillo");
  assert.equal(afinacion.sinRegistro, true);            // el servicio de motor sin regla no cuenta: el rubro tiene dos reglas
  assert.equal(afinacion.km.usado, 48500);              // desde el kilometraje inicial
  assert.equal(balatas.ultimo.servicio, "Balatas traseras");   // único del rubro frenos: cuenta aunque no se ligó
  assert.equal(balatas.km.restante, 46500);
  assert.equal(verif.km, null);
  assert.equal(verif.dias, null);                       // sin servicio no hay fecha base
  assert.equal(textoRestante(verif, String), "sin servicio registrado");
  assert.equal(peorNivel([aceite, afinacion, balatas, verif]), "amarillo");
  assert.equal(textoRestante(aceite, (n) => `${n} km`), "faltan 1500 km · 8 días");
});

test("excedido en días aunque falten km", () => {
  const tracto = { id: "t1", empresa_id: "e", placa: "X", modelo: null, kilometraje_inicial: 0, kilometraje_actual: 5000 };
  const reglas = [{ id: "r", tipo_servicio: "Aceite", intervalo_km: 20000, intervalo_dias: 90, categoria: "motor" }];
  const bitacora = [{ id: "b", tracto_id: "t1", servicio_id: "r", kilometraje_al_servicio: 1000, fecha: "2026-06-01", observaciones: null }];
  const [a] = calcularAlertas(tracto, reglas, bitacora, [], "2026-10-20");
  assert.equal(a.km.nivel, "verde");
  assert.equal(a.dias.nivel, "rojo");
  assert.equal(a.nivel, "rojo");
  assert.equal(textoRestante(a, (n) => `${n} km`), "faltan 16000 km · vencido hace 51 días");
});

// ---- Llantas por posición ------------------------------------------------------------------------------------------
import { posiciones, resumenLlantas, alertaConLlantas, etiquetaPosicion } from "../src/lib/llantas.ts";

test("posiciones: tracto 3 ejes = 10 llantas, góndola 2 ejes = 8", () => {
  assert.equal(posiciones("tracto", 3).length, 10);
  assert.equal(posiciones("gondola", 2).length, 8);
  assert.deepEqual(posiciones("tracto", 2).map((p) => p.codigo), ["E1-I", "E1-D", "E2-IE", "E2-II", "E2-DI", "E2-DE"]);
  assert.equal(etiquetaPosicion("E2-IE"), "Eje 2 izquierda exterior");
});

test("resumen: vencidas, próximas y sin registro; recomendadas = vencidas + próximas", () => {
  const l = (posicion, km_recorridos, vida_km = 100000) => ({ posicion, km_recorridos, vida_km, porcentaje: km_recorridos / vida_km * 100 });
  const r = resumenLlantas(posiciones("tracto", 2), [l("E1-I", 105000), l("E1-D", 95000), l("E2-IE", 20000), l("E2-II", 100000)]);
  assert.deepEqual(r, { total: 6, vencidas: 2, proximas: 1, bien: 1, sinRegistro: 2, recomendadas: 3 });
});

test("la regla de llantas se mide con la llanta vigente más gastada", () => {
  const a = { regla: { id: "r", tipo_servicio: "Llantas", intervalo_km: 120000, intervalo_dias: null, categoria: "llantas" },
    nivel: "verde", porcentaje: 10, km: { usado: 12000, intervalo: 120000, restante: 108000, porcentaje: 10, nivel: "verde" }, dias: null, ultimo: null, sinRegistro: true };
  const llantas = [
    { posicion: "E1-I", km_recorridos: 50000, vida_km: 100000, porcentaje: 50, fecha_instalacion: "2026-01-01", km_instalacion: 300000 },
    { posicion: "E2-IE", km_recorridos: 93000, vida_km: 100000, porcentaje: 93, fecha_instalacion: "2025-06-01", km_instalacion: 250000 },
  ];
  const r = alertaConLlantas(a, llantas);
  assert.equal(r.km.usado, 93000);
  assert.equal(r.nivel, "amarillo");
  assert.match(r.ultimo.servicio, /Eje 2 izquierda exterior/);
  assert.equal(alertaConLlantas({ ...a, regla: { ...a.regla, categoria: "motor" } }, llantas).km.usado, 12000);   // otros rubros no cambian
});

test("numeroLlanta y repartirCosto", async () => {
  const { numeroLlanta, posiciones, repartirCosto } = await import("../src/lib/llantas.ts");
  assert.deepEqual(posiciones("tracto", 3).map((p) => numeroLlanta("tracto", p.codigo)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(posiciones("gondola", 2).map((p) => numeroLlanta("gondola", p.codigo)), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(repartirCosto(100, 3), [33.34, 33.33, 33.33]);
  assert.equal(repartirCosto(7800.01, 4).reduce((a, b) => a + b, 0).toFixed(2), "7800.01");
});

test("resumenPorChofer: solo activos (sin viajes en cero) y orden por comisión", () => {
  const ch = [{ id: "a", nombre: "Ana", activo: true }, { id: "b", nombre: "Beto", activo: true }, { id: "c", nombre: "Chema", activo: false }, { id: "d", nombre: "Dora", activo: false }];
  const v = (id, chofer, sub, folio) => ({ viaje_id: id, chofer_id: chofer, folio, fecha_viaje: "2026-10-20", subtotal: sub, origen: null, destino: null, cliente: null });
  const r = resumenPorChofer(ch, [v("1", "b", 1000, "F1"), v("2", "b", 500, "F1"), v("3", "c", 2000, "F2"), v("4", null, 900, "F3")]);
  assert.deepEqual(r.map((x) => x.nombre), ["Beto", "Ana"]);
  assert.equal(r[0].resumen.viajes, 2);
  assert.equal(r[0].resumen.facturas, 1);
  assert.equal(r[0].resumen.comision, 180);
  assert.equal(r[1].resumen.viajes, 0);
});

test("rutas: decodifica polilínea precisión 6 y da formato al tiempo", async () => {
  const { decodificarPolilinea, duracionTexto } = await import("../src/lib/rutas.ts");
  // (28.6353,-106.0889) (28.7,-106.2) (25.6,-100.3) codificado a precisión 6
  const cod = (pts) => { let o = "", la = 0, lo = 0; for (const [a, b] of pts) { for (const [v, ant] of [[Math.round(a * 1e6), la], [Math.round(b * 1e6), lo]]) { let d = v - ant; d = d < 0 ? ~(d << 1) : d << 1; while (d >= 0x20) { o += String.fromCharCode((0x20 | (d & 0x1f)) + 63); d >>= 5; } o += String.fromCharCode(d + 63); } la = Math.round(a * 1e6); lo = Math.round(b * 1e6); } return o; };
  const pts = [[28.6353, -106.0889], [28.7, -106.2], [25.6, -100.3]];
  assert.deepEqual(decodificarPolilinea(cod(pts)), pts);
  assert.equal(duracionTexto(307), "5 h 07 min");
  assert.equal(duracionTexto(45), "45 min");
  assert.equal(duracionTexto(null), "—");
});

test("cotizador: precio sin pérdida, ganancia y redondeo por unidad", async () => {
  const { cotizar, PARAMETROS_BASE } = await import("../src/lib/cotizador.ts");
  const params = { ...PARAMETROS_BASE, diesel_precio_litro: 25, rendimiento_km_l: 2.5, mant_por_km: 3, depreciacion_por_km: 2, costo_dia: 500,
    horas_jornada: 10, horas_carga_descarga: 2, indirectos_pct: 10, comision_pct: 12, ganancia_pct: 18 };
  const r = cotizar({ km_ida: 100, minutos_ida: 120, redondo: true, cantidad: 30, unidad: "tonelada", casetas: 400, otros: 100, params });
  // 200 km: diésel 80 L × 25 = 2000; desgaste 600; deprec. 400; horas 4+2=6 → 0.6 día × 500 = 300; casetas 400; otros 100
  assert.equal(r.km, 200);
  assert.equal(r.litros, 80);
  assert.deepEqual(r.desglose.map((d) => d.monto), [2000, 600, 400, 300, 400, 100, 380]);
  assert.equal(r.costoBase, 4180);
  assert.equal(r.precioMinimo, 4750);                         // 4180 / 0.88
  assert.equal(r.precioPorUnidad, 200);                       // ceil(4180 / 0.70 / 30 = 199.05) → se cobra por unidad entera
  assert.equal(r.precio, 6000);
  assert.equal(r.comision, 720);
  assert.equal(r.ganancia, 1100);                             // 6000 − 4180 − 720 ≥ 18 % de 6000 (1080)
  assert.ok(r.gananciaPct >= 18);
  assert.equal(r.iva, 960); assert.equal(r.retencionIva, 240); assert.equal(r.total, 6720);
  assert.equal(r.escenarios[0].precio, 4750);                 // ganancia 0 = precio mínimo
});

test("cotizador: nunca cotiza abajo del costo + comisión y valida los datos", async () => {
  const { cotizar, PARAMETROS_BASE } = await import("../src/lib/cotizador.ts");
  for (const [km, min, cant, ganancia, redondo] of [[35, 40, 28, 5, true], [610, 540, 3, 25, false], [12, 15, 100, 0, true], [800, 700, 27.5, 30, true]]) {
    const params = { ...PARAMETROS_BASE, ganancia_pct: ganancia };
    const r = cotizar({ km_ida: km, minutos_ida: min, redondo, cantidad: cant, unidad: "m3", casetas: 0, otros: 0, params });
    assert.ok(r.precio >= r.precioMinimo, "precio ≥ mínimo");
    assert.ok(r.ganancia >= r.precio * ganancia / 100 - 0.01, "ganancia ≥ la deseada");
    assert.ok(r.ganancia >= 0);
  }
  const base = { km_ida: 50, minutos_ida: 60, redondo: true, cantidad: 10, unidad: "tonelada", casetas: 0, otros: 0, params: PARAMETROS_BASE };
  assert.throws(() => cotizar({ ...base, km_ida: 0 }), /ruta/);
  assert.throws(() => cotizar({ ...base, cantidad: 0 }), /toneladas/);
  assert.throws(() => cotizar({ ...base, params: { ...PARAMETROS_BASE, comision_pct: 60, ganancia_pct: 40 } }), /100 %/);
  const sinRegreso = cotizar({ ...base, redondo: false });
  assert.equal(sinRegreso.km, 50);
});

test("cotizador: supuestos desde el historial de la flota", async () => {
  const { parametrosDesdeHistorial, PARAMETROS_BASE } = await import("../src/lib/cotizador.ts");
  const vacio = parametrosDesdeHistorial({ cargas: [], tramos: [], servicios: [], viajes: [] }, "2026-10-20");
  assert.deepEqual(vacio.params, PARAMETROS_BASE);
  assert.deepEqual(vacio.origen, {});
  const h = {
    cargas: [1, 2, 3].map((i) => ({ fecha: `2026-10-0${i}`, costo: 2400, litros: 100 })),
    tramos: [1, 2, 3].map(() => ({ km: 230, litros: 100 })),
    servicios: [{ fecha: "2026-06-01", costo: 60000, tracto_id: "t" }, { fecha: "2026-06-02", costo: 99999, tracto_id: null }],
    viajes: [{ fecha_viaje: "2026-07-01", km: 20000 }],
  };
  const r = parametrosDesdeHistorial(h, "2026-10-20");
  assert.equal(r.params.diesel_precio_litro, 24);
  assert.equal(r.params.rendimiento_km_l, 2.3);
  assert.equal(r.params.mant_por_km, 3);                      // 60000 / 20000 (el servicio sin tracto no cuenta)
  assert.equal(r.origen.mant_por_km.fuente, "historial");
  // km insuficientes: se queda el valor base
  const poco = parametrosDesdeHistorial({ ...h, viajes: [{ fecha_viaje: "2026-07-01", km: 800 }] }, "2026-10-20");
  assert.equal(poco.params.mant_por_km, PARAMETROS_BASE.mant_por_km);
});

test("cotizador: oferta propia, pérdida y totales del formato imprimible", async () => {
  const { cotizar, evaluarOferta, PARAMETROS_BASE, totalesDocumento, vigenciaHasta, folioTexto } = await import("../src/lib/cotizador.ts");
  const params = { ...PARAMETROS_BASE, ganancia_pct: 18, comision_pct: 12 };
  const r = cotizar({ km_ida: 100, minutos_ida: 120, redondo: true, cantidad: 30, unidad: "tonelada", casetas: 400, otros: 100, params });
  const sug = evaluarOferta(r, params, 30);
  assert.equal(sug.precioPorUnidad, r.precioPorUnidad);
  assert.equal(sug.precio, r.precio);
  assert.equal(sug.bajoMinimo, false); assert.equal(sug.bajoDeseado, false);
  const bajo = evaluarOferta(r, params, 30, r.precioMinimoPorUnidad - 20);
  assert.equal(bajo.bajoMinimo, true);
  assert.ok(bajo.ganancia < 0);
  const justo = evaluarOferta(r, params, 30, r.precioMinimoPorUnidad + 5);
  assert.equal(justo.bajoMinimo, false); assert.equal(justo.bajoDeseado, true);
  const t = totalesDocumento({ cantidad: 30, precio_unidad: 200 });
  assert.deepEqual(t, { subtotal: 6000, iva: 960, retencion: 240, total: 6720 });
  assert.equal(vigenciaHasta("2026-10-20", 15), "2026-11-04");
  assert.equal(folioTexto(12), "00012"); assert.equal(folioTexto(null), "SIN FOLIO");
});

test("duplicados: misma remisión o mismos datos; remisiones distintas no lo son", async () => {
  const { gruposDuplicados, claveRemision } = await import("../src/lib/duplicados.ts");
  const v = (id, remision, extra = {}) => ({ id, created_at: `2026-10-0${id.length}T10:00:00Z`, fecha: "2026-10-05T00:00:00+00:00", remision, material: "Arena", cantidad: 28,
    subtotal: 4480, origen: "COX", destino: "ALAMAR", chofer: "JUAN", tracto: "80A1PM", ...extra });
  const g = gruposDuplicados([v("a", "135348"), v("bb", "0135348"), v("c", "135349"), v("d", null), v("ee", null), v("f", null, { cantidad: 30 }), v("g", " 135 349 ")]);
  assert.equal(g.length, 3);
  const rem1 = g.find((x) => x.clave === "rem:135348");
  assert.equal(rem1.motivo, "remision"); assert.equal(rem1.conservar, "a"); assert.deepEqual(rem1.sobran, ["bb"]);
  assert.deepEqual(g.find((x) => x.clave === "rem:135349").sobran, ["g"]);            // c y g: mismo folio con espacios
  const datos = g.find((x) => x.motivo === "datos");
  assert.deepEqual(datos.viajes.map((x) => x.id).sort(), ["d", "ee"]);                  // f cambia la cantidad: no cuenta
  assert.equal(claveRemision("R-0042"), "r0042"); assert.equal(claveRemision(null), "");
  // remisiones parecidas pero distintas
  assert.equal(gruposDuplicados([v("a", "135348"), v("bb", "135349"), v("c", "135350")]).length, 0);
});
