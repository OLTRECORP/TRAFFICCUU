"""Factura con retenciones (IVA e ISR) sin Carta Porte y varios viajes ligados a un mismo XML."""
import os

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "x")
os.environ.setdefault("FERNET_KEY", "x" * 43 + "=")

from app import semanal
from app.cfdi_parser import resumen_cfdi

# Subtotal 10,000 + IVA 1,600 - ret. IVA 400 - ret. ISR 100 = 11,100. Los impuestos de cada concepto no se suman dos veces.
XML = """<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Serie="PU" Folio="55" Fecha="2026-10-12T10:00:00" SubTotal="10000.00" Total="11100.00" Moneda="MXN" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Transportes SA"/>
  <cfdi:Receptor Rfc="PLP010101XX1" Nombre="PETREOS LA PURISIMA"/>
  <cfdi:Conceptos><cfdi:Concepto Descripcion="Flete" Cantidad="1" Importe="10000.00">
    <cfdi:Impuestos>
      <cfdi:Traslados><cfdi:Traslado Impuesto="002" Importe="1600.00"/></cfdi:Traslados>
      <cfdi:Retenciones><cfdi:Retencion Impuesto="002" Importe="400.00"/></cfdi:Retenciones>
    </cfdi:Impuestos></cfdi:Concepto></cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosRetenidos="500.00" TotalImpuestosTrasladados="1600.00">
    <cfdi:Retenciones><cfdi:Retencion Impuesto="002" Importe="400.00"/><cfdi:Retencion Impuesto="001" Importe="100.00"/></cfdi:Retenciones>
    <cfdi:Traslados><cfdi:Traslado Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="1600.00"/></cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="ab12cd34-0000-4000-8000-1234567890ab"/></cfdi:Complemento>
</cfdi:Comprobante>""".encode()


def test_resumen_trae_retenciones_de_iva_e_isr():
    r = resumen_cfdi(XML)
    assert r["impuestos"] == {"iva_trasladado": "1600.00", "retencion_iva": "400.00", "retencion_isr": "100.00",
                              "total_trasladados": "1600.00", "total_retenidos": "500.00"}
    sub, imp = float(r["subtotal"]), r["impuestos"]
    assert sub + float(imp["total_trasladados"]) - float(imp["total_retenidos"]) == float(r["total"])


def test_resumen_sin_impuestos_da_ceros():
    # solo con los impuestos de cada concepto (sin el nodo del comprobante) no hay retenciones que sumar
    sin = XML.decode().split("<cfdi:Impuestos Total")[0].encode() + b"<cfdi:Complemento><tfd:TimbreFiscalDigital UUID=\"ab12cd34-0000-4000-8000-1234567890ab\"/></cfdi:Complemento></cfdi:Comprobante>"
    assert resumen_cfdi(sin)["impuestos"]["retencion_isr"] == "0.00"


class Q:
    def __init__(self, db):
        self.db, self.f, self.op, self.payload, self.lo, self.hi = db, [], "select", None, 0, 10**9

    def select(self, *_): return self
    def eq(self, c, v): self.f.append(lambda r: r.get(c) == v); return self
    def is_(self, c, _v): self.f.append(lambda r: r.get(c) is None); return self
    def in_(self, c, vs): self.f.append(lambda r: r.get(c) in vs); return self
    def order(self, *_a, **_k): return self
    def range(self, a, b): self.lo, self.hi = a, b; return self
    def update(self, p): self.op, self.payload = "update", p; return self

    def execute(self):
        rows = [r for r in self.db.viajes if all(f(r) for f in self.f)]
        if self.op == "update":
            for r in rows:
                r.update(self.payload)
            return type("R", (), {"data": rows})()
        return type("R", (), {"data": rows[self.lo:self.hi + 1]})()


class Clientes(Q):
    def execute(self):
        return type("R", (), {"data": self.db.clientes})()


class DB:
    def __init__(self):
        self.clientes = [{"id": "c1", "nombre": "PETREOS LA PURISIMA", "rfc": None, "alias": ["LA PURISIMA"]},
                         {"id": "c2", "nombre": "OTRO CLIENTE", "rfc": "ZZZ", "alias": []}]
        base = {"empresa_id": "e1", "remision": None, "material": "ARENA", "cantidad": 30, "unidad": "M3", "total": None, "folio_factura": None}
        self.viajes = [
            {**base, "id": "v1", "fecha": "2026-10-05T00:00:00+00:00", "subtotal": 4000, "cliente_id": "c1", "factura_id": None},
            {**base, "id": "v2", "fecha": "2026-10-06T00:00:00+00:00", "subtotal": 6000, "cliente_id": "c1", "factura_id": None},
            {**base, "id": "v3", "fecha": "2026-10-07T00:00:00+00:00", "subtotal": 999, "cliente_id": "c1", "factura_id": "otra"},
            {**base, "id": "v4", "fecha": "2026-10-07T00:00:00+00:00", "subtotal": 500, "cliente_id": "c2", "factura_id": None},
            {**base, "id": "v5", "fecha": "2026-10-01T00:00:00+00:00", "subtotal": 100, "cliente_id": "c1", "factura_id": "f1"},
        ]

    def table(self, name):
        return Clientes(self) if name == "clientes" else Q(self)


def test_viajes_disponibles_son_los_del_cliente_sin_factura_mas_los_de_esta():
    db = DB()
    r = semanal.viajes_disponibles(db, "e1", "f1", {"rfc": "PLP010101XX1", "nombre": "PETREOS LA PURISIMA S.A. DE C.V."})
    assert [c["id"] for c in r["clientes"]] == ["c1"]
    assert {v["id"] for v in r["viajes"]} == {"v1", "v2", "v5"}      # ni v3 (otra factura) ni v4 (otro cliente)


def test_varios_viajes_a_un_mismo_xml_y_desligar():
    db = DB()
    f = {"id": "f1", "folio": "PU55"}
    r = semanal.ligar_viajes(db, "e1", f, ["v1", "v2", "v3"], [])
    assert r == {"ligados": 2, "desligados": 0, "omitidos": 1}       # v3 ya era de otra factura: no se le quita
    assert {v["id"] for v in db.viajes if v["factura_id"] == "f1"} == {"v1", "v2", "v5"}
    assert db.viajes[0]["folio_factura"] == "PU55"
    assert db.viajes[2]["factura_id"] == "otra"
    r = semanal.ligar_viajes(db, "e1", f, [], ["v5", "v3"])
    assert r["desligados"] == 1 and db.viajes[2]["factura_id"] == "otra"
    assert db.viajes[4]["factura_id"] is None and db.viajes[4]["folio_factura"] is None


def test_subir_xml_sin_carta_porte_de_la_empresa_crea_la_factura(monkeypatch):
    from fastapi.testclient import TestClient

    import main
    from app.auth import Tenant, current_tenant

    llamadas = []
    monkeypatch.setattr(main, "asegurar_factura_xml", lambda t, c: (llamadas.append(t.empresa_id) or ("f9", True)))
    sin_clientes = DB()
    sin_clientes.clientes = []     # el receptor no es un cliente con factura semanal registrado
    monkeypatch.setattr(main, "get_admin_client", lambda: sin_clientes)
    main.app.dependency_overrides[current_tenant] = lambda: Tenant(user_id="u", empresa_id="e1", rfc="AAA010101AAA")
    try:
        r = TestClient(main.app).post("/api/xml/procesar", files={"file": ("a.xml", XML, "text/xml")})
        assert r.status_code == 201, r.text
        assert r.json()["factura_id"] == "f9" and r.json()["factura_creada"] and r.json()["sin_carta_porte"]
        # emitido por otra empresa: no es nuestra factura, se rechaza como antes
        main.app.dependency_overrides[current_tenant] = lambda: Tenant(user_id="u", empresa_id="e1", rfc="OTRO010101AAA")
        assert TestClient(main.app).post("/api/xml/procesar", files={"file": ("a.xml", XML, "text/xml")}).status_code == 422
    finally:
        main.app.dependency_overrides.clear()
