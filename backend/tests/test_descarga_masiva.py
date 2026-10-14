import pytest

from app import descarga_masiva as dm
from app.cfdi_parser import pagos_cfdi

U1 = "11111111-1111-4111-8111-111111111111"
U2 = "22222222-2222-4222-8222-222222222222"
UP = "99999999-9999-4999-8999-999999999999"


def cfdi(uuid, tipo="I", serie="A", folio="123", total="11600.00", extra=""):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="4.0" Serie="{serie}" Folio="{folio}" TipoDeComprobante="{tipo}"
  Fecha="2025-03-10T08:30:00" SubTotal="10000.00" Total="{total}">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Transportes SA"/>
  <cfdi:Receptor Rfc="BBB020202BBB" Nombre="Cliente"/>
  <cfdi:Complemento>{extra}<tfd:TimbreFiscalDigital UUID="{uuid}"/></cfdi:Complemento>
</cfdi:Comprobante>""".encode()


def pago(uuid_doc):
    return cfdi(UP, tipo="P", serie="P", folio="7", total="0", extra=f"""<pago20:Pagos Version="2.0">
  <pago20:Pago FechaPago="2025-04-02T12:00:00" Monto="11600.00" MonedaP="MXN">
    <pago20:DoctoRelacionado IdDocumento="{uuid_doc}" NumParcialidad="1" ImpPagado="11600.00"/>
  </pago20:Pago></pago20:Pagos>""")


class FakeQuery:
    def __init__(self, db, name):
        self.db, self.name, self.op, self.payload, self.filters = db, name, None, None, {}

    def upsert(self, rows, on_conflict=None):
        self.op, self.payload, self.conflict = "upsert", rows, on_conflict
        return self

    def update(self, row):
        self.op, self.payload = "update", row
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def execute(self):
        tabla = self.db.tables.setdefault(self.name, [])
        if self.op == "upsert":
            filas = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for f in filas:
                claves = self.conflict.split(",")
                hit = next((r for r in tabla if all(r.get(k) == f.get(k) for k in claves)), None)
                if hit:
                    hit.update(f)
                else:
                    hit = dict(f, id=f"{self.name}-{len(tabla)}")
                    tabla.append(hit)
                out.append(hit)
            return type("R", (), {"data": out})()
        if self.op == "insert":
            fila = dict(self.payload, id=f"{self.name}-{len(tabla)}")
            tabla.append(fila)
            return type("R", (), {"data": [fila]})()
        if self.op == "update":
            for r in tabla:
                if all(r.get(k) == v for k, v in self.filters.items()):
                    r.update(self.payload)
        return type("R", (), {"data": []})()


class FakeDB:
    def __init__(self, **tables):
        self.tables = tables

    def table(self, name):
        return FakeQuery(self, name)


def acumulado():
    return {"xml_recibidos": 0, "ignorados": 0, "facturas_asignadas": 0, "complementos": 0,
            "uuid_recuperados": 0, "sin_asignar": [], "sin_asignar_total": 0}


def facturas():
    return [
        {"id": "f1", "folio": "A123", "uuid": U1, "total": 11600, "estado": "activado", "complemento": "SIN COMPLEMENTO"},
        {"id": "f2", "folio": "A-0456", "uuid": None, "total": 5000, "estado": "activado", "complemento": None},
    ]


def test_normalizar_folio():
    assert dm.normalizar_folio("A-00123") == dm.normalizar_folio("a123") == "a123"
    assert dm.normalizar_folio("0123") == dm.normalizar_folio("123") == "123"
    assert dm.normalizar_folio(None) == ""


def test_asigna_por_uuid_y_guarda_xml():
    db = FakeDB(facturas=facturas())
    acu = acumulado()
    dm.procesar_xmls(db, "e1", dm._Indice(facturas()), [cfdi(U1.upper())], "sol", acu)
    assert acu["facturas_asignadas"] == 1 and acu["sin_asignar_total"] == 0
    fila = db.tables["facturas_sat"][0]
    assert fila["factura_id"] == "f1" and fila["estado"] == "ok" and fila["xml"].startswith("<?xml")


def test_asigna_por_folio_y_total_cuando_falta_uuid_y_lo_recupera():
    fs = facturas()
    db = FakeDB(facturas=fs)
    acu = acumulado()
    dm.procesar_xmls(db, "e1", dm._Indice(fs), [cfdi(U2, serie="A", folio="456", total="5000.00")], None, acu)
    assert acu["facturas_asignadas"] == 1 and acu["uuid_recuperados"] == 1
    assert db.tables["facturas_sat"][0]["factura_id"] == "f2"
    assert fs[1]["uuid"] == U2


def test_folio_igual_pero_total_distinto_queda_sin_asignar():
    db = FakeDB(facturas=facturas())
    acu = acumulado()
    dm.procesar_xmls(db, "e1", dm._Indice(facturas()), [cfdi(U2, folio="456", total="9999.00")], None, acu)
    assert acu["facturas_asignadas"] == 0 and acu["sin_asignar"][0]["uuid"] == U2


def test_folio_y_total_ambiguos_no_asignan():
    fs = [{"id": "a", "folio": "9", "uuid": None, "total": 100, "estado": "activado"},
          {"id": "b", "folio": "9", "uuid": None, "total": 100, "estado": "activado"}]
    acu = acumulado()
    dm.procesar_xmls(FakeDB(facturas=fs), "e1", dm._Indice(fs), [cfdi(U2, serie="", folio="9", total="100")], None, acu)
    assert acu["facturas_asignadas"] == 0 and "varias" in acu["sin_asignar"][0]["motivo"]


def test_complemento_de_pago_se_guarda_y_liga_a_la_factura():
    fs = facturas()
    db = FakeDB(facturas=fs)
    acu = acumulado()
    dm.procesar_xmls(db, "e1", dm._Indice(fs), [pago(U1.upper())], None, acu)
    assert acu["complementos"] == 1 and acu["facturas_asignadas"] == 0
    comp = db.tables["complementos_pago"][0]
    assert comp["uuid"] == UP and comp["fecha_pago"] == "2025-04-02" and comp["monto"] == "11600.00"
    doc = db.tables["complemento_pago_documentos"][0]
    assert doc["uuid_documento"] == U1 and doc["complemento_id"] == comp["id"]
    assert fs[0]["complemento"] == "COMPLEMENTO LISTO"


def test_pagos_cfdi_lee_documentos():
    p = pagos_cfdi(pago(U1.upper()))
    assert p[0]["documentos"][0]["uuid_documento"] == U1.upper() and p[0]["monto"] == "11600.00"


def test_egresos_se_ignoran_y_xml_roto_no_detiene():
    db = FakeDB()
    acu = acumulado()
    dm.procesar_xmls(db, "e1", dm._Indice([]), [cfdi(U2, tipo="E"), b"<no-xml"], None, acu)
    assert acu["ignorados"] == 2 and acu["xml_recibidos"] == 2


def test_cada_xml_asignado_registra_su_carta_porte_y_deja_bitacora(monkeypatch):
    fs = facturas()
    visto = []
    monkeypatch.setattr(dm, "registrar_carta_porte", lambda db, tenant, xml, fid, cat: visto.append(fid) or ("creado", "Viaje A123"))
    lineas = []
    acu = acumulado() | {"viajes": 0, "viajes_existentes": 0, "sin_carta_porte": 0, "viajes_error": 0}
    ctx = {"log": lambda m, n="info": lineas.append((n, m)), "cp": ("tenant", "catalogo")}
    dm.procesar_xmls(FakeDB(facturas=fs), "e1", dm._Indice(fs), [cfdi(U1), cfdi(U2, folio="9", total="1")], None, acu, ctx)
    assert visto == ["f1"] and acu["viajes"] == 1
    assert ("ok", "Carta Porte → Viaje A123") in lineas
    assert any(n == "aviso" and "Sin factura" in m for n, m in lineas)


def test_factura_sin_carta_porte_se_cuenta_sin_romper(monkeypatch):
    fs = facturas()
    monkeypatch.setattr(dm, "registrar_carta_porte", lambda *a: ("sin_carta_porte", "El CFDI no contiene complemento Carta Porte"))
    acu = acumulado() | {"viajes": 0, "viajes_existentes": 0, "sin_carta_porte": 0, "viajes_error": 0}
    dm.procesar_xmls(FakeDB(facturas=fs), "e1", dm._Indice(fs), [cfdi(U1)], None, acu, {"cp": (1, 2)})
    assert acu["sin_carta_porte"] == 1 and acu["facturas_asignadas"] == 1


def test_xml_sin_factura_relacionada_crea_la_factura_y_guarda_el_xml():
    fs = facturas()
    db = FakeDB(facturas=fs)
    acu = dm._contadores()
    dm.procesar_xmls(db, "e1", dm._Indice(fs), [cfdi(U2, serie="B", folio="777", total="2500.00")], None, acu, {"rfc": "AAA010101AAA"})
    assert acu["facturas_creadas"] == 1 and acu["facturas_asignadas"] == 1 and acu["sin_asignar_total"] == 0
    nueva = db.tables["facturas"][-1]
    assert nueva["folio"] == "777" and nueva["uuid"] == U2 and nueva["total"] == "2500.00" and nueva["fecha_emision"] == "2025-03-10"
    assert nueva["estado"] == "activado" and nueva["empresa_id"] == "e1"
    assert db.tables["facturas_sat"][0]["factura_id"] == nueva["id"]


def test_mismo_xml_dos_veces_no_duplica_la_factura():
    fs = facturas()
    db = FakeDB(facturas=fs)
    idx = dm._Indice(fs)
    acu = dm._contadores()
    dm.procesar_xmls(db, "e1", idx, [cfdi(U2, folio="777", total="2500"), cfdi(U2, folio="777", total="2500")], None, acu, {"rfc": "AAA010101AAA"})
    assert acu["facturas_creadas"] == 1 and len(db.tables["facturas"]) == 3


def test_folio_repetido_con_otra_serie_usa_serie_y_folio():
    fs = [{"id": "f1", "folio": "777", "uuid": U1, "total": 100, "estado": "activado"}]
    db = FakeDB(facturas=fs)
    acu = dm._contadores()
    dm.procesar_xmls(db, "e1", dm._Indice(fs), [cfdi(U2, serie="B", folio="777", total="2500")], None, acu, {"rfc": "AAA010101AAA"})
    assert db.tables["facturas"][-1]["folio"] == "B777"


def test_xml_de_otro_emisor_o_ambiguo_no_crea_factura():
    fs = facturas()
    db = FakeDB(facturas=fs)
    acu = dm._contadores()
    dm.procesar_xmls(db, "e1", dm._Indice(fs), [cfdi(U2, folio="777")], None, acu, {"rfc": "OTRO010101XXX"})
    assert acu["facturas_creadas"] == 0 and acu["sin_asignar_total"] == 1 and len(db.tables["facturas"]) == 2
    ambiguas = [{"id": "a", "folio": "9", "uuid": None, "total": 100, "estado": "activado"},
                {"id": "b", "folio": "9", "uuid": None, "total": 100, "estado": "activado"}]
    acu = dm._contadores()
    dm.procesar_xmls(FakeDB(facturas=ambiguas), "e1", dm._Indice(ambiguas), [cfdi(U2, serie="", folio="9", total="100")], None, acu, {"rfc": "AAA010101AAA"})
    assert acu["facturas_creadas"] == 0 and "varias" in acu["sin_asignar"][0]["motivo"]


class FakeDBSuelto:
    """Lo mínimo de supabase-py para el XML suelto: select/eq/is_/in_/order/range, insert, upsert y update."""

    def __init__(self, facturas):
        self.tables = {"facturas": facturas}

    def table(self, name):
        db = self

        class Q(FakeQuery):
            def __init__(self):
                super().__init__(db, name)
                self.f = []

            def select(self, *_): self.op = "select"; return self
            def eq(self, c, v): self.filters[c] = v; self.f.append(lambda r: r.get(c) == v); return self
            def is_(self, c, v): self.f.append(lambda r: r.get(c) is None); return self
            def in_(self, c, vs): self.f.append(lambda r: r.get(c) in vs); return self
            def order(self, *_): return self
            def range(self, a, b): return self

            def execute(self):
                if self.op == "select":
                    tabla = db.tables.setdefault(name, [])
                    return type("R", (), {"data": [r for r in tabla if all(f(r) for f in self.f)]})()
                return super().execute()

        return Q()


def test_xml_suelto_crea_o_liga_la_factura(monkeypatch):
    from app.auth import Tenant
    t = Tenant(user_id="u", empresa_id="e1", rfc="AAA010101AAA")
    db = FakeDBSuelto([{"id": "f2", "folio": "A-0456", "uuid": None, "total": 5000, "estado": "activado", "empresa_id": "e1"}])
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    # 1) sin factura relacionada: se crea
    fid, creada = dm.asegurar_factura_xml(t, cfdi(U1, serie="A", folio="123", total="11600.00"))
    assert creada and fid and db.tables["facturas"][-1]["uuid"] == U1
    # 2) el mismo XML otra vez: reconoce la factura por UUID, no crea otra
    fid2, creada2 = dm.asegurar_factura_xml(t, cfdi(U1, serie="A", folio="123", total="11600.00"))
    assert fid2 == fid and not creada2 and len(db.tables["facturas"]) == 2
    # 3) factura del Excel sin UUID: se liga por folio y total y recupera el UUID
    fid3, creada3 = dm.asegurar_factura_xml(t, cfdi(U2, serie="A", folio="456", total="5000.00"))
    assert fid3 == "f2" and not creada3 and db.tables["facturas"][0]["uuid"] == U2
    # 4) un complemento de pago no es una factura de ingreso
    assert dm.asegurar_factura_xml(t, pago(U1)) == (None, False)
