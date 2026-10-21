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
