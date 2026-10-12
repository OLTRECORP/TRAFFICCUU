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
