import os
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "x")
os.environ.setdefault("FERNET_KEY", "x" * 43 + "=")

import main  # noqa: E402
from app import depuracion  # noqa: E402
from app.auth import Tenant, current_tenant  # noqa: E402

E = "00000000-0000-0000-0000-000000000001"


class FakeRpc:
    def __init__(self, data=None, error=None):
        self.data, self.error, self.llamadas = data, error, []

    def rpc(self, nombre, args):
        self.llamadas.append((nombre, args))
        return self

    def execute(self):
        if self.error:
            raise self.error
        return type("R", (), {"data": self.data})()


@pytest.fixture
def cliente(monkeypatch):
    db = FakeRpc({"facturas": 1})
    monkeypatch.setattr(depuracion, "get_admin_client", lambda: db)
    main.app.dependency_overrides[current_tenant] = lambda: Tenant(user_id="u1", empresa_id=E, rfc="AAA010101AAA")
    yield TestClient(main.app), db
    main.app.dependency_overrides.clear()


def test_eliminar_exige_confirmacion(cliente):
    c, db = cliente
    r = c.post("/api/facturas/eliminar", json={"ids": [str(uuid.uuid4())]})
    assert r.status_code == 400 and db.llamadas == []


def test_eliminar_con_confirmacion_llama_a_la_funcion_con_empresa_y_usuario(cliente):
    c, db = cliente
    fid = str(uuid.uuid4())
    r = c.post("/api/facturas/eliminar", json={"ids": [fid, fid], "motivo": "cancelada", "confirmar": True})
    assert r.status_code == 200
    nombre, args = db.llamadas[0]
    assert nombre == "fn_eliminar_facturas" and args["p_empresa"] == E and args["p_usuario"] == "u1"
    assert args["p_ids"] == [fid] and args["p_motivo"] == "cancelada"   # sin duplicados


def test_unificar_exige_confirmacion_y_vista_previa_no_cambia_nada(cliente):
    c, db = cliente
    cuerpo = {"tipo": "tracto", "origen_id": str(uuid.uuid4()), "destino_id": str(uuid.uuid4())}
    assert c.post("/api/unidades/unificar", json=cuerpo).status_code == 400
    assert c.post("/api/unidades/unificar-vista-previa", json=cuerpo).status_code == 200
    assert [n for n, _ in db.llamadas] == ["fn_vista_previa_unificar"]
    assert c.post("/api/unidades/unificar", json={**cuerpo, "confirmar": True}).status_code == 200
    assert db.llamadas[-1][0] == "fn_unificar_unidad"


def test_falta_la_migracion_se_explica(monkeypatch):
    monkeypatch.setattr(depuracion, "get_admin_client", lambda: FakeRpc(error=Exception("PGRST202 Could not find the function")))
    with pytest.raises(HTTPException) as e:
        depuracion.vista_previa_eliminar(E, [str(uuid.uuid4())])
    assert e.value.status_code == 409 and "017" in e.value.detail


def test_alias_sin_tabla_o_sin_fila_devuelve_none():
    class Db:
        def table(self, _):
            raise Exception("relation does not exist")
    assert depuracion.unidad_por_alias(Db(), E, "tracto", "BAD1") is None
