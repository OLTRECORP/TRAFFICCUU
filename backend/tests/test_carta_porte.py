from app.bitacora import Bitacora
from app.cfdi_parser import UbicacionData
from app.rutas_service import LugaresCatalogo
from app.viajes_service import _ubicacion_row


class Q:
    def __init__(self, db, name):
        self.db, self.name, self.op, self.p = db, name, "select", None

    def select(self, *_): return self
    def eq(self, *_): return self
    def limit(self, *_): return self
    def insert(self, row): self.op, self.p = "insert", row; return self
    def update(self, row): self.op, self.p = "update", row; return self

    def execute(self):
        t = self.db.tables.setdefault(self.name, [])
        if self.op == "insert":
            t.append(dict(self.p, id=f"{self.name}{len(t)}"))
            return type("R", (), {"data": [t[-1]]})()
        if self.op == "update":
            self.db.updates.append((self.name, self.p))
        return type("R", (), {"data": list(t)})()


class DB:
    def __init__(self, **t): self.tables, self.updates = t, []
    def table(self, n): return Q(self, n)


def test_lugares_se_crean_una_vez_y_se_reusan_sin_importar_acentos():
    db = DB(lugares=[{"id": "L1", "nombre": "Planta Chihuahua", "tipo": "origen", "direccion": None}])
    cat = LugaresCatalogo(db, "e1")
    u = UbicacionData("OR1", nombre="PLANTA CHIHUÁHUA", domicilio="Calle 1, Chihuahua")
    assert cat.asegurar(u, "destino") == "L1"                       # reusa
    assert ("lugares", {"tipo": "ambos", "direccion": "Calle 1, Chihuahua"}) in db.updates
    nuevo = cat.asegurar(UbicacionData("DE1", municipio="Monterrey", estado="NLE"), "destino")
    assert nuevo and db.tables["lugares"][-1]["nombre"] == "Monterrey, NLE"
    assert cat.asegurar(UbicacionData("DE9", municipio="Monterrey", estado="NLE"), "destino") == nuevo
    assert len(db.tables["lugares"]) == 2


def test_idubicacion_repetido_no_mezcla_origenes_distintos():
    a = _ubicacion_row(UbicacionData("OR000001", nombre="Planta A"))
    b = _ubicacion_row(UbicacionData("OR000001", nombre="Planta B"))
    assert a["id_ubicacion"] != b["id_ubicacion"]


def test_bitacora_acumula_y_escribe_avisos_al_momento():
    db = DB(sat_descargas=[])
    b = Bitacora(db, "j1")
    b.add("inicio")
    b.add("algo falló", "error")
    assert [l["n"] for l in b.lineas] == ["info", "error"]
    assert db.updates and db.updates[-1][1]["bitacora"][-1]["m"] == "algo falló"
