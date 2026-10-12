import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest

from app import descarga_masiva as dm
from app.sat import Cancelado
from tests.test_descarga_masiva import FakeDB, U1, U2, acumulado, cfdi, facturas


def hacer_zip(archivos: dict[str, bytes]) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for n, d in archivos.items():
            z.writestr(n, d)
    return b.getvalue()


def test_zip_acepta_cfdi_validos_y_rechaza_el_resto_con_motivo(monkeypatch):
    monkeypatch.setattr(dm, "get_settings", lambda: type("S", (), {"max_xml_bytes": 5 * 1024 * 1024})())
    z = hacer_zip({"a/factura.xml": cfdi(U1), "roto.xml": b"<no-xml", "notas.txt": b"hola", "__MACOSX/._x.xml": b"x"})
    acu = acumulado() | {"zip_aceptados": 0, "zip_rechazados": 0}
    lineas = []
    xmls = list(dm._xmls_del_zip(z, lambda m, n="info": lineas.append((n, m)), lambda: False, acu))
    assert len(xmls) == 1 and acu["zip_aceptados"] == 1 and acu["zip_rechazados"] == 2
    textos = [m for _, m in lineas]
    assert any("factura.xml" in m and "aceptado" in m for m in textos)
    assert any("roto.xml" in m and "rechazado" in m for m in textos)
    assert any("notas.txt" in m and "no es .xml" in m for m in textos)


def test_zip_invalido_da_error_claro():
    with pytest.raises(dm.SatError):
        list(dm._xmls_del_zip(b"no es zip", lambda *a: None, lambda: False, {}))


def test_zip_con_demasiados_archivos_se_rechaza(monkeypatch):
    monkeypatch.setattr(dm, "get_settings", lambda: type("S", (), {"max_xml_bytes": 5 * 1024 * 1024})())
    monkeypatch.setattr(dm, "MAX_ZIP_ENTRADAS", 1)
    z = hacer_zip({"1.xml": cfdi(U1), "2.xml": cfdi(U2)})
    with pytest.raises(dm.SatError):
        list(dm._xmls_del_zip(z, lambda *a: None, lambda: False, {}))


def test_detener_a_mitad_conserva_lo_ya_asignado():
    fs = facturas()
    db = FakeDB(facturas=fs)
    acu = acumulado()
    llamadas = iter([False, True])
    with pytest.raises(Cancelado):
        dm.procesar_xmls(db, "e1", dm._Indice(fs), [cfdi(U1), cfdi(U2, folio="9", total="1")], None, acu, {"parar": lambda: next(llamadas)})
    assert acu["facturas_asignadas"] == 1
    assert db.tables["facturas_sat"][0]["factura_id"] == "f1"


class Q:
    def __init__(self, db): self.db, self.op, self.p, self.f = db, "select", None, {}
    def select(self, *_): return self
    def eq(self, c, v): self.f[c] = v; return self
    def in_(self, *_): return self
    def update(self, row): self.op, self.p = "update", row; return self
    def execute(self):
        if self.op == "update":
            self.db.updates.append((dict(self.f), self.p))
        return type("R", (), {"data": self.db.filas})()


class DB:
    def __init__(self, filas): self.filas, self.updates = filas, []
    def table(self, _): return Q(self)


def test_cancelar_marca_interrumpidas_y_avisa_a_las_vivas(monkeypatch):
    ahora = datetime.now(timezone.utc)
    db = DB([{"id": "viva", "updated_at": (ahora - timedelta(seconds=30)).isoformat()},
             {"id": "muerta", "updated_at": (ahora - timedelta(minutes=30)).isoformat()}])
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    assert dm.cancelar("e1") == {"detenidas": 1, "solicitadas": 1}
    por_id = {f["id"]: p for f, p in db.updates}
    assert por_id["viva"] == {"cancelar": True}
    assert por_id["muerta"]["estado"] == "cancelado"
