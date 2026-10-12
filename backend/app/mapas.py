"""Mapa: geocodifica direcciones (Nominatim) y calcula la distancia por carretera (OSRM), ambos de OpenStreetMap.
Los servidores públicos piden un User-Agent propio y poco volumen (≈1 consulta/s): por eso las distancias
se calculan una sola vez por par de lugares y se guardan en `rutas`."""
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
