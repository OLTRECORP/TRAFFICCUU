"""Depurar los viajes importados del Excel de remisiones (p. ej. La Purísima): quitar duplicados o erróneos,
restaurarlos y corregir sus datos. Quitar/restaurar viven en funciones de Postgres (migración 033) para que sean
atómicos y queden respaldados; corregir valida y actualiza aquí."""
from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status

from .db import get_admin_client
from .depuracion import _ids, _rpc

MAX_VIAJES = 500

CAMPOS_TEXTO = ("remision", "material", "unidad")


def quitar(empresa_id: str, usuario_id: str, cliente_id: str, ids: list, motivo: str | None) -> dict:
    """Quita viajes del Excel del cliente. Reimportar el Excel no los vuelve a crear."""
    ids = _ids(ids)
    if len(ids) > MAX_VIAJES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Máximo {MAX_VIAJES} viajes por operación")
    db = get_admin_client()
    de_otro = db.table("viajes").select("id").eq("empresa_id", empresa_id).in_("id", ids).neq("cliente_id", cliente_id).limit(1).execute().data
    if de_otro:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Algún viaje no pertenece a este cliente")
    return _rpc("fn_quitar_viajes_excel", {"p_empresa": empresa_id, "p_ids": ids, "p_motivo": motivo, "p_usuario": usuario_id})


def restaurar(empresa_id: str, usuario_id: str, cliente_id: str, ids: list) -> dict:
    ids = _ids(ids)
    db = get_admin_client()
    ajeno = db.table("viajes_descartados").select("id").eq("empresa_id", empresa_id).in_("id", ids).neq("cliente_id", cliente_id).limit(1).execute().data
    if ajeno:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Algún viaje quitado no pertenece a este cliente")
    return _rpc("fn_restaurar_viajes_excel", {"p_empresa": empresa_id, "p_ids": ids, "p_usuario": usuario_id})


def corregir(empresa_id: str, usuario_id: str, viaje_id: str, cambios: dict) -> dict:
    """Corrige un viaje del Excel. `cambios` solo trae los campos a cambiar; el total sigue al subtotal.
    Si cambia el origen o el destino, los km salen de la ruta ya calculada (o quedan pendientes de calcular)."""
    db = get_admin_client()
    v = db.table("viajes").select("*").eq("empresa_id", empresa_id).eq("id", viaje_id).limit(1).execute().data
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Viaje no encontrado")
    v = v[0]
    if v["origen_registro"] != "excel":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Solo se corrigen viajes del Excel de remisiones; los de un XML salen de su Carta Porte")
    nuevo: dict = {}
    for k in CAMPOS_TEXTO:
        if k in cambios:
            nuevo[k] = (cambios[k] or "").strip() or None
    if "material" in nuevo:
        nuevo["mercancia"] = nuevo["material"]
    for k in ("cantidad", "precio_unitario", "subtotal"):
        if k in cambios:
            x = cambios[k]
            if x is None:
                if k == "subtotal":
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El subtotal es obligatorio")
                nuevo[k] = None
            else:
                if Decimal(str(x)) < 0:
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{k.replace('_', ' ').capitalize()} no puede ser negativo")
                nuevo[k] = float(x)
    if "subtotal" in nuevo:
        nuevo["total"] = nuevo["subtotal"]
    if "fecha" in cambios and cambios["fecha"]:
        f = cambios["fecha"] if isinstance(cambios["fecha"], date) else date.fromisoformat(str(cambios["fecha"]))
        nuevo["fecha"] = nuevo["fecha_salida"] = f"{f.isoformat()}T00:00:00+00:00"
    for k, tabla in (("lugar_origen_id", "lugares"), ("lugar_destino_id", "lugares"), ("chofer_id", "choferes"), ("tracto_id", "tractocamiones"), ("gondola_id", "gondolas")):
        if k in cambios:
            nuevo[k] = str(cambios[k]) if cambios[k] else None
            if nuevo[k] and not db.table(tabla).select("id").eq("empresa_id", empresa_id).eq("id", nuevo[k]).limit(1).execute().data:
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"{k.removesuffix('_id').replace('_', ' ').capitalize()} no encontrado")
    if "lugar_origen_id" in nuevo or "lugar_destino_id" in nuevo:
        o, d = nuevo.get("lugar_origen_id", v["lugar_origen_id"]), nuevo.get("lugar_destino_id", v["lugar_destino_id"])
        ruta = (db.table("rutas").select("distancia_km").eq("empresa_id", empresa_id).eq("origen_id", o).eq("destino_id", d).limit(1).execute().data
                if o and d else [])
        nuevo["distancia_mapa_km"] = float(ruta[0]["distancia_km"]) if ruta else None
    if not nuevo:
        return {"viaje": v, "cambios": {}}
    antes = {k: v.get(k) for k in nuevo}
    actualizado = db.table("viajes").update(nuevo).eq("id", viaje_id).eq("empresa_id", empresa_id).execute().data[0]
    db.table("auditoria_eliminaciones").insert({
        "empresa_id": empresa_id, "accion": "viaje_excel_corregido", "referencia": f"Rem. {v['remision']}" if v.get("remision") else viaje_id,
        "resumen": {"antes": antes, "despues": nuevo}, "respaldo": {"viaje": v}, "usuario_id": usuario_id}).execute()
    return {"viaje": actualizado, "cambios": nuevo}


UNIDADES = (("tracto_id", "tractocamiones", "placa", "Tracto"), ("gondola_id", "gondolas", "placa", "Góndola"), ("chofer_id", "choferes", "nombre", "Chofer"))


def reasignar(empresa_id: str, usuario_id: str, viaje_id: str, cambios: dict, motivo: str | None = None) -> dict:
    """Cambia el tracto, la góndola y/o el chofer de UN viaje (de XML o de Excel), p. ej. por un error de timbrado.
    Solo se aplican las llaves enviadas (null deja el campo sin asignar). Los km del odómetro, las comisiones, el
    rendimiento y la ganancia se calculan sobre viajes.tracto_id / chofer_id, así que se corrigen solos. Deja el
    antes y el después en la bitácora de depuración."""
    db = get_admin_client()
    v = db.table("viajes").select("*").eq("empresa_id", empresa_id).eq("id", viaje_id).limit(1).execute().data
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Viaje no encontrado")
    v = v[0]
    nuevo, etiquetas_antes, etiquetas_despues = {}, {}, {}

    def etiqueta(tabla: str, col: str, id_: str | None) -> str | None:
        if not id_:
            return None
        f = db.table(tabla).select(col).eq("id", id_).limit(1).execute().data
        return f[0][col] if f else None

    for llave, tabla, col, nombre in UNIDADES:
        if llave not in cambios:
            continue
        destino = str(cambios[llave]) if cambios[llave] else None
        if destino and not db.table(tabla).select("id").eq("empresa_id", empresa_id).eq("id", destino).limit(1).execute().data:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"{nombre} no encontrado")
        if destino != (str(v[llave]) if v.get(llave) else None):
            nuevo[llave] = destino
            etiquetas_antes[llave], etiquetas_despues[llave] = etiqueta(tabla, col, v.get(llave)), etiqueta(tabla, col, destino)
    if not nuevo:
        return {"cambios": {}, "antes": {}, "despues": {}}
    db.table("viajes").update(nuevo).eq("id", viaje_id).eq("empresa_id", empresa_id).execute()
    ref = v.get("folio_factura") or (f"Rem. {v['remision']}" if v.get("remision") else viaje_id)
    db.table("auditoria_eliminaciones").insert({
        "empresa_id": empresa_id, "accion": "viaje_reasignado", "referencia": ref, "motivo": (motivo or "").strip() or None,
        "resumen": {"viaje_id": viaje_id, "antes": etiquetas_antes, "despues": etiquetas_despues},
        "respaldo": {"antes": {k: v.get(k) for k in nuevo}, "despues": nuevo}, "usuario_id": usuario_id}).execute()
    return {"cambios": nuevo, "antes": etiquetas_antes, "despues": etiquetas_despues}
