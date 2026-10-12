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


class Chain:
    """Fake de supabase permisivo: cualquier método encadenable devuelve el mismo objeto; execute() devuelve filas."""
    def __init__(self, db, name): self.db, self.name, self.op, self.p, self.single_ = db, name, "select", None, False
    def __getattr__(self, _): return lambda *a, **k: self
    @property
    def not_(self): return self
    def single(self): self.single_ = True; return self
    def insert(self, row): self.op, self.p = "insert", row; return self
    def upsert(self, row, **_): self.op, self.p = "upsert", row; return self
    def update(self, row): self.op, self.p = "update", row; return self

    def execute(self):
        t = self.db.tables.setdefault(self.name, [])
        if self.op in ("insert", "upsert"):
            filas = self.p if isinstance(self.p, list) else [self.p]
            t.extend(dict(f, id=f.get("id", f"{self.name}{len(t)}")) for f in filas)
            return type("R", (), {"data": t[-len(filas):]})()
        if self.op == "update":
            self.db.updates.append((self.name, self.p))
            return type("R", (), {"data": t})()
        data = t[0] if self.single_ and t else t
        return type("R", (), {"data": data})()


class ChainDB:
    def __init__(self, **t): self.tables, self.updates = t, []
    def table(self, n): return Chain(self, n)


def test_ejecutar_un_zip_de_punta_a_punta_no_truena(monkeypatch):
    """Regresión: _ejecutar usaba _contadores/_reprocesar que no existían (NameError al subir un .zip)."""
    db = ChainDB(empresa_configuracion=[{"id": "e1", "rfc": "AAA010101AAA"}], facturas=facturas())
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    monkeypatch.setattr(dm, "get_settings", lambda: type("S", (), {"max_xml_bytes": 5 * 1024 * 1024})())
    dm.ejecutar("e1", "job1", 2026, [], hacer_zip({"a.xml": cfdi(U1), "roto.xml": b"<no"}))
    finales = [p for t, p in db.updates if t == "sat_descargas"]
    assert finales and finales[-1]["estado"] in ("ok", "error")
    assert not any("NameError" in str(p.get("error")) for p in finales)
    assert finales[-1]["estado"] == "ok" and finales[-1]["facturas_asignadas"] == 1


def test_ejecutar_reprocesar_no_truena(monkeypatch):
    db = ChainDB(empresa_configuracion=[{"id": "e1", "rfc": "AAA010101AAA"}], facturas=facturas())
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    dm.ejecutar("e1", "job2", 2026, [])
    finales = [p for t, p in db.updates if t == "sat_descargas"]
    assert finales and finales[-1]["estado"] == "ok"
