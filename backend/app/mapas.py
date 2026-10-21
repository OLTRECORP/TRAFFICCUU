"""Mapa: geocodifica direcciones (Nominatim) y calcula la distancia por carretera (OSRM), ambos de OpenStreetMap.
Los servidores públicos piden un User-Agent propio y poco volumen (≈1 consulta/s): por eso las distancias
se calculan una sola vez por par de lugares y se guardan en `rutas`."""
import json

import httpx

from .config import get_settings


class MapaError(Exception):
    """Fallo al consultar el mapa; el mensaje se muestra al usuario."""


def _get(url: str, params: dict) -> dict | list:
    s = get_settings()
    try:
        r = httpx.get(url, params=params, headers={"User-Agent": s.maps_user_agent}, timeout=20)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as exc:
        raise MapaError(f"No se pudo consultar el mapa ({type(exc).__name__})") from exc


def geocodificar(direccion: str) -> dict:
    """Primera coincidencia en México: {lat, lng, nombre}."""
    datos = _get(f"{get_settings().nominatim_url.rstrip('/')}/search",
                 {"q": direccion, "format": "jsonv2", "limit": 1, "countrycodes": "mx"})
    if not datos:
        raise MapaError("No se encontró esa dirección; agrega municipio y estado o marca el punto en el mapa")
    return {"lat": round(float(datos[0]["lat"]), 6), "lng": round(float(datos[0]["lon"]), 6), "nombre": datos[0].get("display_name")}


def distancia_km(origen: tuple[float, float], destino: tuple[float, float]) -> float:
    """Kilómetros por carretera de ida entre dos puntos (lat, lng)."""
    ruta = f"{origen[1]},{origen[0]};{destino[1]},{destino[0]}"
    datos = _get(f"{get_settings().osrm_url.rstrip('/')}/route/v1/driving/{ruta}", {"overview": "false"})
    if datos.get("code") != "Ok" or not datos.get("routes"):
        raise MapaError("El mapa no encontró una ruta por carretera entre esos puntos")
    return round(datos["routes"][0]["distance"] / 1000, 2)


def decodificar_polilinea(codigo: str, precision: int = 6) -> list[tuple[float, float]]:
    """Polilínea codificada (Valhalla/OSRM, precisión 6) -> [(lat, lng), ...]."""
    puntos, i, lat, lng, f = [], 0, 0, 0, 10 ** precision
    while i < len(codigo):
        for eje in (0, 1):
            desplazo = resultado = 0
            while True:
                b = ord(codigo[i]) - 63
                i += 1
                resultado |= (b & 0x1F) << desplazo
                desplazo += 5
                if b < 0x20:
                    break
            delta = ~(resultado >> 1) if resultado & 1 else resultado >> 1
            if eje == 0:
                lat += delta
            else:
                lng += delta
        puntos.append((lat / f, lng / f))
    return puntos


def _valhalla_camion(origen: tuple[float, float], destino: tuple[float, float]) -> dict:
    s = get_settings()
    consulta = {
        "locations": [{"lat": origen[0], "lon": origen[1]}, {"lat": destino[0], "lon": destino[1]}],
        "costing": "truck", "directions_type": "none",
        "costing_options": {"truck": {"height": s.camion_alto_m, "width": s.camion_ancho_m, "length": s.camion_largo_m, "weight": s.camion_peso_ton}},
    }
    datos = _get(f"{s.valhalla_url.rstrip('/')}/route", {"json": json.dumps(consulta)})
    viaje = datos.get("trip") if isinstance(datos, dict) else None
    if not viaje or viaje.get("status", 0) != 0 or not viaje.get("legs"):
        raise MapaError("El mapa no encontró una ruta para camión entre esos puntos")
    return {"km": round(float(viaje["summary"]["length"]), 2), "minutos": round(float(viaje["summary"]["time"]) / 60),
            "geometria": viaje["legs"][0]["shape"], "fuente": "valhalla-camion"}


def _osrm_auto(origen: tuple[float, float], destino: tuple[float, float]) -> dict:
    s = get_settings()
    ruta = f"{origen[1]},{origen[0]};{destino[1]},{destino[0]}"
    datos = _get(f"{s.osrm_url.rstrip('/')}/route/v1/driving/{ruta}", {"overview": "full", "geometries": "polyline6"})
    if datos.get("code") != "Ok" or not datos.get("routes"):
        raise MapaError("El mapa no encontró una ruta por carretera entre esos puntos")
    r = datos["routes"][0]
    return {"km": round(r["distance"] / 1000, 2), "minutos": round(r["duration"] / 60 * s.factor_tiempo_camion),
            "geometria": r.get("geometry"), "fuente": "osrm-auto"}


def ruta_camion(origen: tuple[float, float], destino: tuple[float, float]) -> dict:
    """Ruta óptima por calles y carreteras para camión de carga, no en línea recta:
    {km, minutos, geometria (polilínea precisión 6), fuente}. Primero Valhalla con perfil de camión; si falla,
    OSRM (auto) con el tiempo ajustado por `factor_tiempo_camion`."""
    try:
        return _valhalla_camion(origen, destino)
    except MapaError:
        return _osrm_auto(origen, destino)
