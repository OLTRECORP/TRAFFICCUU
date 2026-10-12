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
    assert ("lugares", {"tipo": "ambos", "direccion": "Calle 1, Chihuahua", "cliente": "PLANTA CHIHUÁHUA"}) in db.updates
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


XML_TON = """<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:cartaporte31="http://www.sat.gob.mx/CartaPorte31"
 Version="4.0" Serie="B" Folio="1" Fecha="2026-07-08T13:21:26" SubTotal="4370.70" Total="4895.18">
<cfdi:Emisor Rfc="AAA010101AAA"/><cfdi:Receptor Rfc="BBB010101BBB"/>
<cfdi:Conceptos><cfdi:Concepto ClaveUnidad="A75" Unidad="TONELADA" Cantidad="51.42" ValorUnitario="85.00"/></cfdi:Conceptos>
<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="9FB3A96F-6D44-42DF-9E93-EEF40E619099"/>
<cartaporte31:CartaPorte Version="3.1"><cartaporte31:Ubicaciones>
<cartaporte31:Ubicacion TipoUbicacion="Origen" NombreRemitenteDestinatario="CLIENTE " FechaHoraSalidaLlegada="2026-07-07T06:00:00"><cartaporte31:Domicilio Calle="KM 1" Estado="BCN"/></cartaporte31:Ubicacion>
<cartaporte31:Ubicacion TipoUbicacion="Destino" NombreRemitenteDestinatario="CLIENTE" FechaHoraSalidaLlegada="2026-07-07T13:00:00" DistanciaRecorrida="23"><cartaporte31:Domicilio Calle="PLANTA SAN PEDRO" Estado="BCN"/></cartaporte31:Ubicacion>
</cartaporte31:Ubicaciones>
<cartaporte31:Mercancias PesoBrutoTotal="48000"><cartaporte31:Mercancia Descripcion="Gravilla"/>
<cartaporte31:Autotransporte PermSCT="TPAF01" NumPermisoSCT="123"><cartaporte31:IdentificacionVehicular ConfigVehicular="C2R3" PlacaVM="42BJ1K" AnioModeloVM="2011"/>
<cartaporte31:Seguros AseguraRespCivil="AXA" PolizaRespCivil="999"/>
<cartaporte31:Remolques><cartaporte31:Remolque SubTipoRem="CTR014" Placa="15UY8W"/></cartaporte31:Remolques></cartaporte31:Autotransporte></cartaporte31:Mercancias>
<cartaporte31:FiguraTransporte><cartaporte31:TiposFigura TipoFigura="01" RFCFigura="POMA7005077I8" NombreFigura="X"/></cartaporte31:FiguraTransporte>
</cartaporte31:CartaPorte></cfdi:Complemento></cfdi:Comprobante>"""


def test_parser_toneladas_precio_fechas_y_ficha_del_tracto():
    from decimal import Decimal
    from app.cfdi_parser import parse_cfdi
    v = parse_cfdi(XML_TON.encode())
    assert (v.toneladas_facturadas, v.precio_tonelada) == (Decimal("51.42"), Decimal("85.00"))
    assert v.peso_bruto_total_kg == 48000 and v.mercancia == "Gravilla"
    assert v.origen.fecha.hour == 6 and v.destino.fecha.hour == 13 and v.destino.calle == "PLANTA SAN PEDRO"
    assert (v.tipo_permiso_sct, v.num_permiso_sct, v.aseguradora, v.poliza_seguro) == ("TPAF01", "123", "AXA", "999")


def test_precio_tonelada_del_xml_sobrescribe_y_deja_aviso():
    db = DB(lugares=[{"id": "L1", "nombre": "CLIENTE - PLANTA SAN PEDRO", "tipo": "destino", "direccion": "x", "precio_tonelada": 80.0}])
    cat = LugaresCatalogo(db, "e1")
    u = UbicacionData("DE1", nombre="CLIENTE", calle="PLANTA SAN PEDRO")
    assert cat.asegurar(u, "destino", 85) == "L1"
    assert ("lugares", {"cliente": "CLIENTE", "precio_tonelada": 85.0}) in db.updates
    assert "80.0 → 85.0" in cat.avisos[0]
    nuevo = cat.asegurar(UbicacionData("DE2", nombre="OTRO", calle="P2"), "destino", 70)
    assert db.tables["lugares"][-1]["precio_tonelada"] == 70.0 and nuevo


def test_cliente_con_varios_destinos_no_se_mezcla_y_conserva_el_cliente():
    db = DB(lugares=[])
    cat = LugaresCatalogo(db, "e1")
    a = cat.asegurar(UbicacionData("D1", nombre="TRITURADOS ROCA", calle="PLANTA UNO", domicilio="PLANTA UNO, BCN"), "destino")
    b = cat.asegurar(UbicacionData("D1", nombre="TRITURADOS ROCA", calle="PLANTA DOS", domicilio="PLANTA DOS, BCN"), "destino")
    assert a != b and len(db.tables["lugares"]) == 2
    assert {l["nombre"] for l in db.tables["lugares"]} == {"TRITURADOS ROCA - PLANTA UNO", "TRITURADOS ROCA - PLANTA DOS"}
    assert all(l["cliente"] == "TRITURADOS ROCA" for l in db.tables["lugares"])
    # el mismo lugar de entrega se reutiliza
    assert cat.asegurar(UbicacionData("D9", nombre="TRITURADOS ROCA", calle="PLANTA UNO"), "destino") == a


def test_resumen_cfdi_trae_referencia_del_destino():
    from app.cfdi_parser import resumen_cfdi
    r = resumen_cfdi(XML_TON.encode())
    destino = [u for u in r["carta_porte"]["ubicaciones"] if u["tipo"] == "Destino"][0]
    assert destino["referencia"] == "CLIENTE - PLANTA SAN PEDRO" and destino["calle"] == "PLANTA SAN PEDRO"
