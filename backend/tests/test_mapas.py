import pytest

from app import mapas, rutas_service


def test_geocodificar_toma_la_primera_coincidencia(monkeypatch):
    monkeypatch.setattr(mapas, "get_settings", lambda: type("S", (), {"nominatim_url": "http://n/", "osrm_url": "http://o", "maps_user_agent": "t"})())
    monkeypatch.setattr(mapas, "_get", lambda url, params: [{"lat": "28.6353", "lon": "-106.0889", "display_name": "Chihuahua"}])
    assert mapas.geocodificar("Chihuahua") == {"lat": 28.6353, "lng": -106.0889, "nombre": "Chihuahua"}


def test_geocodificar_sin_resultados(monkeypatch):
    monkeypatch.setattr(mapas, "get_settings", lambda: type("S", (), {"nominatim_url": "http://n", "osrm_url": "http://o", "maps_user_agent": "t"})())
    monkeypatch.setattr(mapas, "_get", lambda url, params: [])
    with pytest.raises(mapas.MapaError):
        mapas.geocodificar("zzz")


def test_distancia_km_convierte_metros_y_usa_lng_lat(monkeypatch):
    visto = {}
    monkeypatch.setattr(mapas, "get_settings", lambda: type("S", (), {"nominatim_url": "http://n", "osrm_url": "http://o/", "maps_user_agent": "t"})())

    def falso(url, params):
        visto["url"] = url
        return {"code": "Ok", "routes": [{"distance": 123456.7}]}

    monkeypatch.setattr(mapas, "_get", falso)
    assert mapas.distancia_km((28.6, -106.0), (25.6, -100.3)) == 123.46
    assert visto["url"].endswith("/route/v1/driving/-106.0,28.6;-100.3,25.6")


def test_nombres_se_comparan_sin_acentos_ni_mayusculas():
    assert rutas_service._norm("Planta Chihuahua ") == rutas_service._norm("PLANTA  CHIHUÁHUA")


def _ajustes(**extra):
    base = {"nominatim_url": "http://n", "osrm_url": "http://o", "valhalla_url": "http://v/", "maps_user_agent": "t", "factor_tiempo_camion": 1.25,
            "camion_alto_m": 4.25, "camion_ancho_m": 2.6, "camion_largo_m": 18.3, "camion_peso_ton": 40.0, **extra}
    return lambda: type("S", (), base)()


def test_polilinea_se_decodifica_con_precision_6():
    # ejemplo de la documentación de Google (precisión 5) reescalado: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    def cod(puntos, p=6):
        out, la, lo = "", 0, 0
        for lat, lng in puntos:
            for v, ant in ((round(lat * 10 ** p), la), (round(lng * 10 ** p), lo)):
                d = v - ant
                d = ~(d << 1) if d < 0 else d << 1
                while d >= 0x20:
                    out += chr((0x20 | (d & 0x1F)) + 63)
                    d >>= 5
                out += chr(d + 63)
            la, lo = round(lat * 10 ** p), round(lng * 10 ** p)
        return out
    pts = [(28.6353, -106.0889), (28.7, -106.2), (25.6, -100.3)]
    got = mapas.decodificar_polilinea(cod(pts))
    assert [(round(a, 4), round(b, 4)) for a, b in got] == pts


def test_ruta_camion_usa_valhalla_con_perfil_truck(monkeypatch):
    visto = {}
    monkeypatch.setattr(mapas, "get_settings", _ajustes())

    def falso(url, params):
        visto["url"], visto["json"] = url, params["json"]
        return {"trip": {"status": 0, "summary": {"length": 412.37, "time": 18420}, "legs": [{"shape": "abc"}]}}

    monkeypatch.setattr(mapas, "_get", falso)
    r = mapas.ruta_camion((28.6, -106.0), (25.6, -100.3))
    assert r == {"km": 412.37, "minutos": 307, "geometria": "abc", "fuente": "valhalla-camion"}
    assert visto["url"] == "http://v/route"
    assert '"costing": "truck"' in visto["json"] and '"height": 4.25' in visto["json"]


def test_ruta_camion_cae_a_osrm_con_tiempo_ajustado(monkeypatch):
    monkeypatch.setattr(mapas, "get_settings", _ajustes())

    def falso(url, params):
        if "/route/v1/driving/" in url:
            assert params["overview"] == "full" and params["geometries"] == "polyline6"
            return {"code": "Ok", "routes": [{"distance": 400000, "duration": 18000, "geometry": "xyz"}]}
        raise mapas.MapaError("valhalla caído")

    monkeypatch.setattr(mapas, "_get", falso)
    r = mapas.ruta_camion((28.6, -106.0), (25.6, -100.3))
    assert r == {"km": 400.0, "minutos": 375, "geometria": "xyz", "fuente": "osrm-auto"}


def test_cotizador_ruta_geocodifica_direcciones_y_acepta_puntos(monkeypatch):
    import main
    llamadas = []
    monkeypatch.setattr(main, "geocodificar", lambda d: llamadas.append(d) or {"lat": 32.5, "lng": -116.6, "nombre": d})
    monkeypatch.setattr(main.time, "sleep", lambda s: None)
    monkeypatch.setattr(main, "ruta_camion", lambda o, d: {"km": 100.5, "minutos": 95, "geometria": "g", "fuente": "valhalla-camion"})
    # origen por punto del mapa, destino por dirección: solo se geocodifica el destino
    r = main.cotizador_ruta(main.CotizadorRutaRequest(origen={"lat": 28.6, "lng": -106.0}, destino={"direccion": "Tecate, BC"}), None)
    assert llamadas == ["Tecate, BC"]
    assert r["km"] == 100.5 and r["minutos"] == 95 and r["destino"]["lat"] == 32.5 and r["origen"]["lng"] == -106.0


def test_cotizador_ruta_exige_direccion_o_punto():
    import main
    with pytest.raises(Exception):
        main.CotizadorRutaRequest(origen={}, destino={"direccion": "Tecate"})


def test_cotizador_ruta_error_del_mapa_es_502(monkeypatch):
    import main
    from fastapi import HTTPException
    monkeypatch.setattr(main, "ruta_camion", lambda o, d: (_ for _ in ()).throw(mapas.MapaError("sin ruta")))
    with pytest.raises(HTTPException) as e:
        main.cotizador_ruta(main.CotizadorRutaRequest(origen={"lat": 1, "lng": 1}, destino={"lat": 2, "lng": 2}), None)
    assert e.value.status_code == 502


def test_corregir_viaje_valida_y_recalcula_km(monkeypatch):
    from app import viajes_excel
    from fastapi import HTTPException
    viaje = {"id": "V1", "empresa_id": "e1", "origen_registro": "excel", "remision": "100", "lugar_origen_id": "O1", "lugar_destino_id": "D1", "distancia_mapa_km": 10.0}
    tablas = {"viajes": [viaje], "lugares": [{"id": "O2"}], "rutas": [{"origen_id": "O2", "destino_id": "D1", "distancia_km": 42.5}], "auditoria_eliminaciones": []}

    class Q:
        def __init__(s, t): s.t, s.f, s.op, s.p = t, {}, "select", None
        def select(s, *_): return s
        def eq(s, k, v): s.f[k] = v; return s
        def limit(s, *_): return s
        def update(s, p): s.op, s.p = "update", p; return s
        def insert(s, p): s.op, s.p = "insert", p; return s
        def execute(s):
            filas = tablas[s.t]
            if s.op == "insert":
                filas.append(s.p); return type("R", (), {"data": [s.p]})()
            sel = [r for r in filas if all(r.get(k) == v for k, v in s.f.items() if k != "empresa_id")]
            if s.op == "update":
                for r in sel:
                    r.update(s.p)
            return type("R", (), {"data": sel})()

    monkeypatch.setattr(viajes_excel, "get_admin_client", lambda: type("DB", (), {"table": lambda self, t: Q(t)})())
    r = viajes_excel.corregir("e1", "u1", "V1", {"subtotal": 1500, "lugar_origen_id": "O2", "material": " Arena ", "remision": ""})
    assert r["cambios"]["total"] == 1500.0 and r["cambios"]["distancia_mapa_km"] == 42.5
    assert viaje["mercancia"] == "Arena" and viaje["remision"] is None and viaje["subtotal"] == 1500.0
    assert tablas["auditoria_eliminaciones"][0]["accion"] == "viaje_excel_corregido"
    with pytest.raises(HTTPException) as e:
        viajes_excel.corregir("e1", "u1", "V1", {"lugar_origen_id": "NO-EXISTE"})
    assert e.value.status_code == 404
    viaje["origen_registro"] = "xml"
    with pytest.raises(HTTPException) as e:
        viajes_excel.corregir("e1", "u1", "V1", {"subtotal": 1})
    assert e.value.status_code == 422


def test_reasignar_tracto_y_chofer_de_un_viaje(monkeypatch):
    from app import viajes_excel
    from fastapi import HTTPException
    viaje = {"id": "V1", "empresa_id": "e1", "origen_registro": "xml", "folio_factura": "B1404", "tracto_id": "T1", "gondola_id": "G1", "chofer_id": "C1"}
    tablas = {"viajes": [viaje], "tractocamiones": [{"id": "T1", "placa": "80A1PM"}, {"id": "T2", "placa": "44AX1L"}],
              "gondolas": [{"id": "G1", "placa": "89UP8A"}], "choferes": [{"id": "C1", "nombre": "JUAN"}, {"id": "C2", "nombre": "PEDRO"}], "auditoria_eliminaciones": []}

    class Q:
        def __init__(s, t): s.t, s.f, s.op, s.p = t, {}, "select", None
        def select(s, *_): return s
        def eq(s, k, v): s.f[k] = v; return s
        def limit(s, *_): return s
        def update(s, p): s.op, s.p = "update", p; return s
        def insert(s, p): s.op, s.p = "insert", p; return s
        def execute(s):
            filas = tablas[s.t]
            if s.op == "insert":
                filas.append(s.p); return type("R", (), {"data": [s.p]})()
            sel = [r for r in filas if all(r.get(k) == v for k, v in s.f.items() if k != "empresa_id")]
            if s.op == "update":
                for r in sel:
                    r.update(s.p)
            return type("R", (), {"data": sel})()

    monkeypatch.setattr(viajes_excel, "get_admin_client", lambda: type("DB", (), {"table": lambda self, t: Q(t)})())
    r = viajes_excel.reasignar("e1", "u1", "V1", {"tracto_id": "T2", "chofer_id": "C2", "gondola_id": "G1"}, " error de timbrado ")
    assert r["cambios"] == {"tracto_id": "T2", "chofer_id": "C2"}                    # la góndola no cambió: no se toca
    assert (viaje["tracto_id"], viaje["chofer_id"], viaje["gondola_id"]) == ("T2", "C2", "G1")
    a = tablas["auditoria_eliminaciones"][0]
    assert a["accion"] == "viaje_reasignado" and a["referencia"] == "B1404" and a["motivo"] == "error de timbrado"
    assert a["resumen"]["antes"] == {"tracto_id": "80A1PM", "chofer_id": "JUAN"} and a["resumen"]["despues"] == {"tracto_id": "44AX1L", "chofer_id": "PEDRO"}
    assert viajes_excel.reasignar("e1", "u1", "V1", {"tracto_id": "T2"}) == {"cambios": {}, "antes": {}, "despues": {}}   # sin cambios: no audita
    assert len(tablas["auditoria_eliminaciones"]) == 1
    with pytest.raises(HTTPException) as e:
        viajes_excel.reasignar("e1", "u1", "V1", {"chofer_id": "NO"})
    assert e.value.status_code == 404
    viajes_excel.reasignar("e1", "u1", "V1", {"gondola_id": None})
    assert viaje["gondola_id"] is None


def test_asignar_exige_algun_campo():
    import main
    with pytest.raises(Exception):
        main.AsignarViajeRequest()
    assert main.AsignarViajeRequest(chofer_id=None).model_fields_set == {"chofer_id"}
