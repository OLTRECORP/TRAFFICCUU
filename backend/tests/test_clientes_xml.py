import os

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "x")
os.environ.setdefault("FERNET_KEY", "x" * 43 + "=")

from app.clientes_service import asignar_clientes_desde_xml  # noqa: E402


class Q:
    def __init__(self, db, tabla): self.db, self.tabla, self.upd, self.f = db, tabla, None, {}
    def select(self, *_): return self
    def eq(self, c, v): self.f[c] = v; return self
    def in_(self, *_): return self
    def is_(self, *_): return self
    @property
    def not_(self): return self
    def order(self, *_, **__): return self
    def range(self, *_): return self
    def update(self, d): self.upd = d; return self
    def insert(self, d): self.db.nuevos.append(d); return self
    def execute(self):
        if self.upd is not None:
            self.db.cambios.append((self.f.get("id"), self.upd))
            return type("R", (), {"data": []})()
        datos = {"viajes": self.db.viajes, "facturas_sat": self.db.sat, "clientes": self.db.clientes}.get(self.tabla, [])
        if self.db.nuevos and self.tabla == "clientes":
            return type("R", (), {"data": [{"id": "nuevo"}]})()
        return type("R", (), {"data": datos})()


class Db:
    def __init__(self):
        self.cambios, self.nuevos = [], []
        self.clientes = [{"id": "c1", "nombre": "CONSTRUCTORA SA", "rfc": "CON010101AAA", "alias": []}]
        self.viajes = [
            {"id": "v1", "factura_id": "f1", "cliente_id": "viejo", "rfc_receptor": "CON010101AAA"},   # cliente equivocado
            {"id": "v2", "factura_id": "f2", "cliente_id": "c1", "rfc_receptor": "CON010101AAA"},      # ya correcto
            {"id": "v3", "factura_id": "f3", "cliente_id": None, "rfc_receptor": "AAA010101AAA"},      # receptor = la empresa: no se asigna
        ]
        self.sat = [{"factura_id": "f1", "receptor": {"rfc": "CON010101AAA", "nombre": "CONSTRUCTORA SA"}},
                    {"factura_id": "f2", "receptor": {"rfc": "CON010101AAA", "nombre": "CONSTRUCTORA SA"}},
                    {"factura_id": "f3", "receptor": {"rfc": "AAA010101AAA", "nombre": ""}}]

    def table(self, t): return Q(self, t)


def test_asigna_el_cliente_del_receptor_solo_donde_cambia():
    db = Db()
    r = asignar_clientes_desde_xml(db, "e1", "AAA010101AAA")
    assert r["asignados"] == 1 and r["revisados"] == 3
    assert db.cambios == [("v1", {"cliente_id": "c1"})]
