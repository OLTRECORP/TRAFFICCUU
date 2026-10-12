from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app import facturas_sat
from app.cfdi_parser import CFDIError, resumen_cfdi
from tests.test_parser import make_xml

UUID = "ab12cd34-0000-4000-8000-1234567890ab"


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload, self.filters = db, table, "select", None, {}

    def select(self, *_):
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def limit(self, _):
        return self

    def upsert(self, row, on_conflict=None):
        self.op, self.payload = "upsert", row
        return self

    def update(self, row):
        self.op, self.payload = "update", row
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        match = [r for r in rows if all(r.get(k) == v for k, v in self.filters.items())]
        if self.op == "upsert":
            hit = next((r for r in rows if r["factura_id"] == self.payload["factura_id"]), None)
            if hit:
                hit.update(self.payload)
            else:
                rows.append(dict(self.payload, updated_at=datetime.now(timezone.utc).isoformat(), actualizado_en=None))
        elif self.op == "update":
            for r in match:
                r.update(self.payload)
        return type("R", (), {"data": match})()


class FakeDB:
    def __init__(self, **tables):
        self.tables = tables

    def table(self, name):
        return FakeQuery(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB(facturas=[{"id": "f1", "empresa_id": "e1", "folio": "A1", "uuid": UUID}], facturas_sat=[])
    monkeypatch.setattr(facturas_sat, "get_admin_client", lambda: fake)
    return fake


def test_resumen_con_carta_porte():
    r = resumen_cfdi(make_xml())
    assert r["uuid"] == UUID.upper() and r["total"] == "11600.00"
    assert r["emisor"]["rfc"] == "AAA010101AAA"
    cp = r["carta_porte"]
    assert cp["version"] == "2.0" and cp["vehiculo"]["placa"] == "12AB3C"
    assert cp["remolques"][0]["placa"] == "99XY1Z" and cp["figuras"][0]["nombre"] == "Juan Pérez"
    assert [u["tipo"] for u in cp["ubicaciones"]] == ["Origen", "Destino"]


def test_resumen_sin_carta_porte_y_xxe():
    xml = make_xml().decode().replace("CartaPorte", "Otro").encode()
    assert resumen_cfdi(xml)["carta_porte"] is None
    with pytest.raises(CFDIError):
        resumen_cfdi(b'<!DOCTYPE x [<!ENTITY a "b">]><cfdi:Comprobante xmlns:cfdi="x"/>')


def test_primera_vez_lanza_descarga(db):
    r = facturas_sat.preparar("e1", "f1", forzar=False)
    assert r == {"estado": "pendiente", "omitido": False, "uuid": UUID}
    assert db.tables["facturas_sat"][0]["estado"] == "pendiente"


def test_con_datos_actualizados_no_vuelve_a_descargar(db):
    db.tables["facturas_sat"].append({"factura_id": "f1", "estado": "ok", "actualizado_en": "2026-01-01T00:00:00+00:00",
                                      "updated_at": "2026-01-01T00:00:00+00:00"})
    assert facturas_sat.preparar("e1", "f1", forzar=False)["omitido"] is True
    assert facturas_sat.preparar("e1", "f1", forzar=True)["omitido"] is False  # botón manual


def test_pendiente_reciente_no_duplica(db):
    db.tables["facturas_sat"].append({"factura_id": "f1", "estado": "pendiente", "actualizado_en": None,
                                      "updated_at": datetime.now(timezone.utc).isoformat()})
    assert facturas_sat.preparar("e1", "f1", forzar=True)["omitido"] is True


def test_otra_empresa_y_uuid_danado(db):
    with pytest.raises(HTTPException) as e:
        facturas_sat.preparar("otra", "f1", forzar=False)
    assert e.value.status_code == 404
    db.tables["facturas"][0]["uuid"] = None
    with pytest.raises(HTTPException) as e:
        facturas_sat.preparar("e1", "f1", forzar=False)
    assert e.value.status_code == 422


def test_ejecutar_guarda_datos_y_errores(db, monkeypatch):
    facturas_sat.preparar("e1", "f1", forzar=False)
    monkeypatch.setattr(facturas_sat, "descargar_cfdi_por_uuid", lambda *a, **k: make_xml())
    facturas_sat.ejecutar("e1", "f1", UUID)
    fila = db.tables["facturas_sat"][0]
    assert fila["estado"] == "ok" and fila["actualizado_en"] and fila["datos"]["carta_porte"]["version"] == "2.0"

    def falla(*a, **k):
        raise facturas_sat.SatError("FIEL vencida")
    monkeypatch.setattr(facturas_sat, "descargar_cfdi_por_uuid", falla)
    facturas_sat.ejecutar("e1", "f1", UUID)
    assert fila["estado"] == "error" and fila["error"] == "FIEL vencida" and fila["datos"]  # conserva lo anterior


def test_xml_de_otro_uuid_se_rechaza(db, monkeypatch):
    facturas_sat.preparar("e1", "f1", forzar=False)
    monkeypatch.setattr(facturas_sat, "descargar_cfdi_por_uuid", lambda *a, **k: make_xml())
    facturas_sat.ejecutar("e1", "f1", "11111111-1111-4111-8111-111111111111")
    assert db.tables["facturas_sat"][0]["estado"] == "error"
