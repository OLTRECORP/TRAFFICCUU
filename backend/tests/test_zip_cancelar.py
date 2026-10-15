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


def test_keepalive_hace_ping_mientras_corre_y_se_detiene(monkeypatch):
    import time
    from app import keepalive
    llamadas = []
    monkeypatch.setattr(keepalive, "_ping", lambda url: llamadas.append(url))
    with keepalive.mantener_despierto(intervalo=0.01, url="https://api.example.com/") as activo:
        assert activo
        time.sleep(0.15)
    n = len(llamadas)
    assert n >= 2 and llamadas[0] == "https://api.example.com/health"
    time.sleep(0.1)
    assert len(llamadas) == n   # al terminar la corrida deja de hacer ping
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    with keepalive.mantener_despierto() as activo:
        assert activo is False


def test_retoma_la_solicitud_anterior_en_lugar_de_pedir_otra(monkeypatch):
    ahora = datetime.now(timezone.utc).isoformat()
    db = ChainDB(sat_descargas=[
        {"id": "j0", "anio": 2026, "created_at": ahora, "detalle": [
            {"mes": 6, "estado": "ok", "solicitud": "SOL-OK"},
            {"mes": 7, "estado": "en_proceso", "solicitud": "38ab88e5-1111"},
            {"mes": 8, "estado": "error", "solicitud": None}]}])
    assert dm._solicitud_previa(db, "e1", 2026, 7) == "38ab88e5-1111"
    assert dm._solicitud_previa(db, "e1", 2026, 6) is None
    assert dm._solicitud_previa(db, "e1", 2026, 8) is None
    vieja = (datetime.now(timezone.utc) - timedelta(hours=100)).isoformat()
    db2 = ChainDB(sat_descargas=[{"id": "j", "anio": 2026, "created_at": vieja, "detalle": [{"mes": 7, "estado": "error", "solicitud": "X"}]}])
    assert dm._solicitud_previa(db2, "e1", 2026, 7) is None


def test_xmls_mes_usa_la_previa_y_si_el_sat_la_rechaza_pide_una_nueva(monkeypatch):
    visto = []

    def falso(empresa_id, ini, fin, on_solicitud=None, log=None, parar=None, id_existente=None):
        visto.append(id_existente)
        if id_existente:
            raise dm.SatError("solicitud vencida")
        on_solicitud("NUEVA")
        yield b"<xml/>"

    monkeypatch.setattr(dm, "descargar_emitidos_rango", falso)
    guardadas = []
    salida = list(dm._xmls_mes("e1", None, None, lambda *a: None, lambda: False, "VIEJA", guardadas.append))
    assert salida == [b"<xml/>"] and visto == ["VIEJA", None] and guardadas == ["NUEVA"]


def test_ejecutar_por_meses_guarda_la_solicitud_y_termina_ok(monkeypatch):
    db = ChainDB(empresa_configuracion=[{"id": "e1", "rfc": "AAA010101AAA"}], facturas=facturas(), sat_descargas=[])
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    monkeypatch.setattr(dm, "get_settings", lambda: type("S", (), {"max_xml_bytes": 5 * 1024 * 1024})())

    def falso(empresa_id, ini, fin, on_solicitud=None, log=None, parar=None, id_existente=None):
        on_solicitud("SOL-1")
        yield cfdi(U1)

    monkeypatch.setattr(dm, "descargar_emitidos_rango", falso)
    dm.ejecutar("e1", "job3", 2026, [1])
    finales = [p for t, p in db.updates if t == "sat_descargas"]
    assert finales[-1]["estado"] == "ok" and finales[-1]["facturas_asignadas"] == 1
    assert finales[-1]["detalle"][0]["estado"] == "ok" and finales[-1]["detalle"][0]["solicitud"] == "SOL-1"


def test_reprocesar_solo_registra_las_facturas_con_xml_que_aun_no_tienen_viaje(monkeypatch):
    db = ChainDB(
        facturas=[{"id": "f1", "folio": "1"}, {"id": "f2", "folio": "2"}],
        facturas_sat=[{"factura_id": "f1", "xml": "<a/>"}, {"factura_id": "f2", "xml": "<b/>"}],
        viajes=[{"factura_id": "f1"}],
    )
    registradas = []
    monkeypatch.setattr(dm, "_carta_porte", lambda db_, cp, xml, factura, acu, avisar: registradas.append(factura["id"]))
    acu = dm._contadores()
    dm._reprocesar(db, "e1", {"log": lambda *a: None, "parar": lambda: False, "cp": (None, None)}, acu)
    assert registradas == ["f2"]   # f1 ya tiene viaje y no se repasa


def test_cada_mes_es_un_punto_de_control_y_la_siguiente_corrida_omite_los_guardados(monkeypatch):
    ahora = datetime.now(timezone.utc).isoformat()
    db = ChainDB(empresa_configuracion=[{"id": "e1", "rfc": "AAA010101AAA"}], facturas=facturas(), sat_descargas=[])
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    monkeypatch.setattr(dm, "get_settings", lambda: type("S", (), {"max_xml_bytes": 5 * 1024 * 1024})())
    pedidos = []

    def falso(empresa_id, ini, fin, on_solicitud=None, log=None, parar=None, id_existente=None):
        pedidos.append(ini.month)
        if ini.month == 2:
            raise dm.SatError("el SAT se cayó")
        yield cfdi(U1)

    monkeypatch.setattr(dm, "descargar_emitidos_rango", falso)
    dm.ejecutar("e1", "job4", 2026, [1, 2])
    finales = [p for t, p in db.updates if t == "sat_descargas"]
    detalle = finales[-1]["detalle"]
    assert detalle[0]["mes"] == 1 and detalle[0]["guardado"] is True       # el mes 1 quedó guardado
    assert detalle[1]["estado"] == "error" and not detalle[1]["guardado"]   # el 2 falló pero no tumbó al 1
    assert finales[-1]["facturas_asignadas"] == 1
    assert any(r["factura_id"] == "f1" for r in db.tables["facturas_sat"])

    # la siguiente corrida (la anterior no terminó bien) omite el mes 1 y solo pide el 2
    db.tables["sat_descargas"] = [{"id": "job4", "estado": "error", "anio": 2026, "created_at": ahora, "detalle": detalle}]
    pedidos.clear()
    dm.ejecutar("e1", "job5", 2026, [1, 2])
    assert pedidos == [2]


def test_el_avance_se_guarda_en_lotes_mientras_se_recorre_el_mes(monkeypatch):
    fs = [{"id": f"f{i}", "folio": str(i), "uuid": None, "total": "1", "estado": "vigente", "complemento": None} for i in range(1, 4)]
    db = ChainDB(facturas_sat=[])
    monkeypatch.setattr(dm, "LOTE_GUARDADO", 2)
    guardados_a_media = []

    def xmls():
        yield cfdi(U1, folio="1", total="1")
        yield cfdi(U2, folio="2", total="1")
        guardados_a_media.append(len(db.tables["facturas_sat"]))   # al llegar al 3.º ya se guardaron los 2 primeros
        raise dm.SatError("se cortó")

    with pytest.raises(dm.SatError):
        dm.procesar_xmls(db, "e1", dm._Indice(fs), xmls(), None, dm._contadores(), {})
    assert guardados_a_media == [2]


def test_limite_5002_detiene_la_corrida_sin_pedir_mas_meses(monkeypatch):
    db = ChainDB(empresa_configuracion=[{"id": "e1", "rfc": "AAA010101AAA"}], facturas=facturas(), sat_descargas=[])
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    monkeypatch.setattr(dm, "get_settings", lambda: type("S", (), {"max_xml_bytes": 5 * 1024 * 1024})())
    pedidos = []

    def falso(empresa_id, ini, fin, on_solicitud=None, log=None, parar=None, id_existente=None):
        pedidos.append(ini.month)
        raise dm.SatLimite("El SAT no aceptó la solicitud (código 5002): Se han agotado las solicitudes de por vida")
        yield

    monkeypatch.setattr(dm, "descargar_emitidos_rango", falso)
    dm.ejecutar("e1", "job6", 2026, [1, 2, 3])
    final = [p for t, p in db.updates if t == "sat_descargas"][-1]
    assert pedidos == [1]                                   # no se intentó el 2 ni el 3, ni se reintentó el 1
    assert final["estado"] == "error" and "5002" in final["error"]


def test_xmls_mes_no_pide_otra_si_la_previa_sigue_en_proceso_o_hay_limite(monkeypatch):
    for exc in (dm.SatPendiente("sigue procesando"), dm.SatLimite("agotado")):
        visto = []

        def falso(empresa_id, ini, fin, on_solicitud=None, log=None, parar=None, id_existente=None, exc=exc):
            visto.append(id_existente)
            raise exc
            yield

        monkeypatch.setattr(dm, "descargar_emitidos_rango", falso)
        try:
            list(dm._xmls_mes("e1", None, None, lambda *a: None, lambda: False, "VIEJA", lambda i: None))
            assert False, "debía propagar el error"
        except (dm.SatPendiente, dm.SatLimite):
            pass
        assert visto == ["VIEJA"]   # nunca se pidió una solicitud nueva


def test_meses_cerrados_de_corridas_terminadas_no_se_vuelven_a_pedir():
    vieja = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    hoy = datetime.now(timezone.utc)
    db = ChainDB(sat_descargas=[{"id": "j0", "estado": "ok", "anio": hoy.year, "created_at": vieja, "detalle": [
        {"mes": 1, "estado": "ok", "guardado": True}, {"mes": hoy.month, "estado": "ok", "guardado": True}]}])
    hechos = dm._meses_guardados(db, "e1", hoy.year, "otro")
    assert 1 in hechos or hoy.month == 1
    assert hoy.month not in hechos   # el mes en curso sigue cambiando: se vuelve a pedir


def test_iniciar_con_mes_pide_solo_ese_mes(monkeypatch):
    db = ChainDB(sat_descargas=[])
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    monkeypatch.setattr(dm, "meses_pendientes", lambda *a: pytest.fail("con mes no se calculan los faltantes"))
    fila = dm.iniciar("e1", 2024, "faltantes", mes=3)
    assert fila["meses"] == [3]
    with pytest.raises(dm.HTTPException):
        dm.iniciar("e1", 2024, "faltantes", mes=13)
    with pytest.raises(dm.HTTPException):
        dm.iniciar("e1", datetime.now().year, "anio", mes=datetime.now().month % 12 + 1 if datetime.now().month < 12 else 13)


def test_cliente_pide_al_sat_solo_su_rfc_y_no_marca_el_mes_como_guardado(monkeypatch):
    db = ChainDB(empresa_configuracion=[{"id": "e1", "rfc": "AAA010101AAA"}], facturas=facturas(), sat_descargas=[])
    monkeypatch.setattr(dm, "get_admin_client", lambda: db)
    monkeypatch.setattr(dm, "get_settings", lambda: type("S", (), {"max_xml_bytes": 5 * 1024 * 1024})())
    pedidos = []

    def falso(empresa_id, ini, fin, on_solicitud=None, log=None, parar=None, id_existente=None, rfc_receptor=None):
        pedidos.append(rfc_receptor)
        yield cfdi(U1)

    monkeypatch.setattr(dm, "descargar_emitidos_rango", falso)
    dm.ejecutar("e1", "job7", 2026, [1], None, "BBB020202BBB")
    assert pedidos == ["BBB020202BBB"]
    final = [p for t, p in db.updates if t == "sat_descargas"][-1]
    assert final["detalle"][0]["estado"] == "ok" and final["detalle"][0]["guardado"] is False
