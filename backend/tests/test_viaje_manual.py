import pytest
from fastapi import HTTPException

from app import viajes_excel
from tests.test_remisiones import FakeDB


def _db():
    return FakeDB(clientes=[{"id": "K1", "empresa_id": "e1", "rfc": "ABC010101AAA"}],
                  lugares=[{"id": "L1", "empresa_id": "e1"}, {"id": "L2", "empresa_id": "e1"}],
                  choferes=[{"id": "C1", "empresa_id": "e1"}], tractocamiones=[{"id": "T1", "empresa_id": "e1"}], gondolas=[],
                  rutas=[{"origen_id": "L1", "destino_id": "L2", "distancia_km": 42.5}], viajes=[], auditoria_eliminaciones=[])


def _usar(monkeypatch, db):
    monkeypatch.setattr(viajes_excel, "get_admin_client", lambda: db)


def test_crear_manual_sin_factura_con_subtotal_de_cantidad_por_precio(monkeypatch):
    db = _db(); _usar(monkeypatch, db)
    v = viajes_excel.crear_manual("e1", "u1", "K1", {"fecha": "2026-11-20", "cantidad": 30, "precio_unitario": 120.5, "unidad": "ton",
                                                      "lugar_origen_id": "L1", "lugar_destino_id": "L2", "chofer_id": "C1", "tracto_id": "T1"})
    assert (v["origen_registro"], v["subtotal"], v["total"], v["unidad"]) == ("manual", 3615.0, 3615.0, "TON")
    assert (v["cliente_id"], v["chofer_id"], v["tracto_id"], v["distancia_mapa_km"]) == ("K1", "C1", "T1", 42.5)
    assert v["import_key"] is None and not v.get("factura_id") and v["rfc_receptor"] == "ABC010101AAA"
    assert db.t["auditoria_eliminaciones"][0]["accion"] == "viaje_manual_creado"


def test_crear_manual_valida_subtotal_y_catalogos(monkeypatch):
    db = _db(); _usar(monkeypatch, db)
    with pytest.raises(HTTPException) as e:
        viajes_excel.crear_manual("e1", "u1", "K1", {"fecha": "2026-11-20"})
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        viajes_excel.crear_manual("e1", "u1", "K1", {"fecha": "2026-11-20", "subtotal": 100, "chofer_id": "NO"})
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        viajes_excel.crear_manual("e1", "u1", "NOPE", {"fecha": "2026-11-20", "subtotal": 100})
    assert e.value.status_code == 404 and not db.t["viajes"]


def test_corregir_acepta_manuales_y_rechaza_xml(monkeypatch):
    db = _db(); _usar(monkeypatch, db)
    v = viajes_excel.crear_manual("e1", "u1", "K1", {"fecha": "2026-11-20", "subtotal": 100})
    r = viajes_excel.corregir("e1", "u1", v["id"], {"subtotal": 250})
    assert r["viaje"]["subtotal"] == 250 and r["viaje"]["total"] == 250
    db.t["viajes"][0]["origen_registro"] = "xml"
    with pytest.raises(HTTPException):
        viajes_excel.corregir("e1", "u1", v["id"], {"subtotal": 1})
