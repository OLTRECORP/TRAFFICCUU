// Ejecutar: npm test  (Node >= 22.18: ejecuta .ts directamente)
import test from "node:test";
import assert from "node:assert/strict";
import { semanaPago, semanaPagoDesplazada, estadisticas, etiquetaSemanaPago } from "../src/lib/comisiones.ts";
import { tramos, cargasPorDia } from "../src/lib/combustible.ts";

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
