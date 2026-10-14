"""Orígenes/destinos (`lugares`), distancias entre ellos (`rutas`) y km operativos de los viajes.
Km operativos de un viaje = distancia de ida por mapa x 2 (la unidad regresa), igual que la regla del XML."""
import logging
import re
import time
import unicodedata
from datetime import datetime, timezone

from fastapi import HTTPException, status

from .db import get_admin_client
from .mapas import MapaError, distancia_km, geocodificar

logger = logging.getLogger("rutas")

MAX_UBICAR = 20         # lugares por corrida que se ubican en el mapa a partir de su dirección
MAX_RUTAS_NUEVAS = 40   # por corrida, para no saturar el servidor público de OSRM
PRESUPUESTO_SEG = 40    # tiempo máximo por corrida; el proxy de Vercel corta a los 55 s y devolvería 502


def _norm(texto: str | None) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


class LugaresCatalogo:
    """Catálogo `lugares` de la empresa en memoria, para dar de alta los orígenes/destinos de las Cartas Porte
    sin una consulta por viaje. Coincide por nombre sin acentos ni mayúsculas."""

    def __init__(self, db, empresa_id: str):
        self.db, self.empresa_id = db, empresa_id
        self.avisos: list[str] = []   # cambios hechos a lugares existentes, para la bitácora
        filas = db.table("lugares").select("id, nombre, tipo, direccion, precio_tonelada, cliente").eq("empresa_id", empresa_id).limit(10000).execute().data
        self.por_nombre = {_norm(f["nombre"]): f for f in filas}

    def asegurar(self, u, tipo: str, precio_tonelada=None) -> str | None:
        """Id del lugar para una ubicación de Carta Porte (UbicacionData); lo crea si no existe.
        El nombre es «cliente - lugar de entrega» (ej. «TRITURADOS ROCA DE BC - CEMEX ... PLANTA SAN PEDRO TECATE»).
        El cliente va aparte (`cliente`): un cliente puede tener varios destinos y nunca se reutiliza un lugar solo
        porque el cliente coincida; un lugar existente se reutiliza únicamente si tiene la misma dirección.
        El precio por tonelada del XML sobrescribe el del destino; el cambio se anota en `avisos`."""
        base = (u.nombre or "").strip()
        nombre = (f"{base} - {u.calle}" if base and u.calle else base or u.calle
                  or ", ".join(p for p in (u.municipio, u.estado) if p) or "").strip()
        if not nombre:
            return None
        lugar = self.por_nombre.get(_norm(nombre))
        if lugar is None and base:
            simple = self.por_nombre.get(_norm(base))
            if simple and u.domicilio and simple.get("direccion") == u.domicilio:
                lugar = simple
        if lugar:
            cambios = {}
            if lugar["tipo"] not in (tipo, "ambos"):
                cambios["tipo"] = "ambos"
            if not lugar.get("direccion") and u.domicilio:
                cambios["direccion"] = u.domicilio
            if base and not lugar.get("cliente"):
                cambios["cliente"] = base
            if tipo == "destino" and precio_tonelada is not None and lugar.get("precio_tonelada") != float(precio_tonelada):
                antes = lugar.get("precio_tonelada")
                cambios["precio_tonelada"] = float(precio_tonelada)
                self.avisos.append(
                    f"Precio por tonelada de «{lugar['nombre']}»: {'sin precio' if antes is None else antes} → {float(precio_tonelada)} (del XML)")
            if cambios:
                self.db.table("lugares").update(cambios).eq("id", lugar["id"]).execute()
                lugar.update(cambios)
            return lugar["id"]
        fila = {"empresa_id": self.empresa_id, "nombre": nombre, "tipo": tipo, "direccion": u.domicilio,
                "referencia": "Creado desde la Carta Porte", "cliente": base or None}
        if tipo == "destino" and precio_tonelada is not None:
            fila["precio_tonelada"] = float(precio_tonelada)
        nuevo = self.db.table("lugares").insert(fila).execute().data[0]
        self.por_nombre[_norm(nombre)] = nuevo
        return nuevo["id"]


def _lugar(db, empresa_id: str, lugar_id: str) -> dict:
    fila = db.table("lugares").select("id, nombre, lat, lng").eq("id", lugar_id).eq("empresa_id", empresa_id).limit(1).execute().data
    if not fila:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lugar no encontrado")
    return fila[0]


def _punto(lugar: dict) -> tuple[float, float]:
    if lugar.get("lat") is None or lugar.get("lng") is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"«{lugar['nombre']}» no tiene ubicación en el mapa")
    return float(lugar["lat"]), float(lugar["lng"])


def calcular_ruta(empresa_id: str, origen_id: str, destino_id: str, forzar: bool = False) -> dict:
    """Distancia de ida entre dos lugares; usa la guardada salvo `forzar`. Actualiza los viajes que la usan."""
    db = get_admin_client()
    origen, destino = _lugar(db, empresa_id, origen_id), _lugar(db, empresa_id, destino_id)
    if origen_id == destino_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El origen y el destino son el mismo lugar")
    previa = (
        db.table("rutas").select("id, distancia_km").eq("empresa_id", empresa_id)
        .eq("origen_id", origen_id).eq("destino_id", destino_id).limit(1).execute().data
    )
    if previa and not forzar:
        km = float(previa[0]["distancia_km"])
    else:
        po, pd = _punto(origen), _punto(destino)
        try:
            km = distancia_km(po, pd)
        except MapaError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
        db.table("rutas").upsert(
            {"empresa_id": empresa_id, "origen_id": origen_id, "destino_id": destino_id, "distancia_km": km,
             "fuente": "osrm", "calculada_en": datetime.now(timezone.utc).isoformat()},
            on_conflict="empresa_id,origen_id,destino_id",
        ).execute()
    db.table("viajes").update({"distancia_mapa_km": km}).eq("empresa_id", empresa_id) \
        .eq("lugar_origen_id", origen_id).eq("lugar_destino_id", destino_id).execute()
    return {"distancia_km": km, "km_operativos": round(km * 2, 2)}


def asignar_viaje(empresa_id: str, viaje_id: str, origen_id: str | None, destino_id: str | None) -> dict:
    """Asigna origen y destino a un viaje (None los quita) y calcula sus km operativos."""
    db = get_admin_client()
    if not db.table("viajes").select("id").eq("id", viaje_id).eq("empresa_id", empresa_id).limit(1).execute().data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Viaje no encontrado")
    for lid in (origen_id, destino_id):
        if lid:
            _lugar(db, empresa_id, lid)
    db.table("viajes").update(
        {"lugar_origen_id": origen_id, "lugar_destino_id": destino_id, "distancia_mapa_km": None}
    ).eq("id", viaje_id).execute()
    if origen_id and destino_id:
        return calcular_ruta(empresa_id, origen_id, destino_id)
    return {"distancia_km": None, "km_operativos": None}


def ubicar_lugares(empresa_id: str, log=None, limite: float | None = None) -> int:
    """Pone latitud/longitud a los lugares sin ubicar usando su dirección (o su nombre). Devuelve cuántos ubicó."""
    db = get_admin_client()
    pendientes = (
        db.table("lugares").select("id, nombre, direccion").eq("empresa_id", empresa_id).eq("activo", True)
        .is_("lat", "null").limit(MAX_UBICAR).execute().data
    )
    ubicados = 0
    for i, l in enumerate(pendientes):
        if limite is not None and time.monotonic() > limite:
            break
        if i:
            time.sleep(1.1)   # política de uso de Nominatim: máximo ~1 consulta por segundo
        consulta = l.get("direccion") or f"{l['nombre']}, México"
        try:
            r = geocodificar(consulta)
            db.table("lugares").update({"lat": r["lat"], "lng": r["lng"]}).eq("id", l["id"]).execute()
            ubicados += 1
            if log:
                log(f"Lugar «{l['nombre']}» ubicado en el mapa ({r['lat']}, {r['lng']})", "ok")
        except MapaError as exc:
            if log:
                log(f"Lugar «{l['nombre']}» sin ubicar: {exc}", "aviso")
    return ubicados


def calcular_km_viajes(empresa_id: str, log=None) -> dict:
    """1) A los viajes sin lugares les pone origen/destino cuyo nombre coincide con el de la Carta Porte
    (sin acentos ni mayúsculas). 2) Calcula los km de los que ya tienen ambos lugares y les falta la distancia."""
    db = get_admin_client()
    limite = time.monotonic() + PRESUPUESTO_SEG
    ubicados = ubicar_lugares(empresa_id, log, limite)
    lugares = db.table("lugares").select("id, nombre, lat, lng").eq("empresa_id", empresa_id).eq("activo", True).execute().data
    por_nombre = {_norm(l["nombre"]): l["id"] for l in lugares}
    viajes = db.table("viajes").select(
        "id, lugar_origen_id, lugar_destino_id, distancia_mapa_km, "
        "origen:ubicaciones!origen_id(nombre, municipio), destino:ubicaciones!destino_id(nombre, municipio)"
    ).eq("empresa_id", empresa_id).is_("distancia_mapa_km", "null").limit(5000).execute().data

    def buscar(u: dict | None) -> str | None:
        return next((por_nombre[k] for k in (_norm((u or {}).get("nombre")), _norm((u or {}).get("municipio"))) if k in por_nombre), None)

    res = {"asignados": 0, "calculados": 0, "sin_coincidencia": 0, "sin_mapa": 0, "pendientes": 0, "ubicados": ubicados}
    nuevas = 0
    hechos: dict[tuple[str, str], bool] = {}   # par ya resuelto en esta corrida (True = se calculó)
    for v in viajes:
        o, d = v["lugar_origen_id"], v["lugar_destino_id"]
        if not (o and d):
            o, d = o or buscar(v["origen"]), d or buscar(v["destino"])
            if not (o and d):
                res["sin_coincidencia"] += 1
                continue
            db.table("viajes").update({"lugar_origen_id": o, "lugar_destino_id": d}).eq("id", v["id"]).execute()
            res["asignados"] += 1
        if (o, d) in hechos:
            res["calculados" if hechos[(o, d)] else "sin_mapa"] += 1
            continue
        existe = db.table("rutas").select("id").eq("empresa_id", empresa_id).eq("origen_id", o).eq("destino_id", d).limit(1).execute().data
        if not existe:
            if nuevas >= MAX_RUTAS_NUEVAS or time.monotonic() > limite:
                res["pendientes"] += 1
                continue
            nuevas += 1
        try:
            calcular_ruta(empresa_id, o, d)
            res["calculados"] += 1
            hechos[(o, d)] = True
        except HTTPException as exc:
            res["sin_mapa"] += 1
            hechos[(o, d)] = False
            logger.warning("Viaje %s: %s", v["id"], exc.detail)
    return res
