"""Datos del SAT por factura: descarga el CFDI por UUID, lo resume (incl. Carta Porte) y lo guarda
en `facturas_sat`. Si la factura ya tiene datos del SAT no se vuelve a descargar salvo que se pida."""
import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from .auth import Tenant
from .carta_porte_service import registrar as registrar_carta_porte
from .cfdi_parser import CFDIError, resumen_cfdi
from .db import get_admin_client
from .rutas_service import LugaresCatalogo
from .sat import SatError, descargar_cfdi_por_uuid

log = logging.getLogger("facturas_sat")

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
# Una solicitud "pendiente" más vieja que esto se considera abandonada (p. ej. se reinició el servidor).
PENDIENTE_MAX = timedelta(minutes=20)


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def preparar(empresa_id: str, factura_id: str, forzar: bool) -> dict:
    """Valida y marca la factura como pendiente. Devuelve {"estado", "omitido", "uuid"};
    `omitido` = ya había datos actualizados del SAT (o una descarga en curso) y no se lanza nada."""
    db = get_admin_client()
    fac = (
        db.table("facturas").select("id, folio, uuid")
        .eq("id", factura_id).eq("empresa_id", empresa_id).limit(1).execute().data
    )
    if not fac:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Factura no encontrada")
    uuid = fac[0].get("uuid")
    if not uuid or not UUID_RE.match(str(uuid)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "La factura no tiene un folio fiscal (UUID) válido; corrígelo en el Excel y vuelve a importarlo",
        )

    previa = (
        db.table("facturas_sat").select("estado, actualizado_en, updated_at")
        .eq("factura_id", factura_id).limit(1).execute().data
    )
    if previa:
        p = previa[0]
        if p["estado"] == "pendiente" and _ahora() - _parse_ts(p["updated_at"]) < PENDIENTE_MAX:
            return {"estado": "pendiente", "omitido": True, "uuid": str(uuid)}
        if p["estado"] == "ok" and p["actualizado_en"] and not forzar:
            return {"estado": "ok", "omitido": True, "uuid": str(uuid)}

    # Se conserva el XML/datos anteriores mientras se actualiza: si el SAT falla no se pierden.
    db.table("facturas_sat").upsert(
        {"factura_id": factura_id, "empresa_id": empresa_id, "uuid": str(uuid), "estado": "pendiente", "error": None},
        on_conflict="factura_id",
    ).execute()
    return {"estado": "pendiente", "omitido": False, "uuid": str(uuid)}


def ejecutar(empresa_id: str, factura_id: str, uuid: str) -> None:
    """Tarea de fondo: toda excepción termina en estado='error' con un mensaje legible."""
    db = get_admin_client()
    tabla = db.table("facturas_sat")

    def guardar_solicitud(id_solicitud: str) -> None:
        tabla.update({"id_solicitud": id_solicitud}).eq("factura_id", factura_id).execute()

    try:
        xml = descargar_cfdi_por_uuid(empresa_id, uuid, on_solicitud=guardar_solicitud)
        datos = resumen_cfdi(xml)
        if datos["uuid"].lower() != uuid.lower():
            raise SatError("El XML descargado no corresponde al UUID de la factura")
        tabla.update({
            "estado": "ok", "error": None, "datos": datos, "xml": xml.decode("utf-8", errors="replace"),
            "actualizado_en": _ahora().isoformat(),
        }).eq("factura_id", factura_id).execute()
        log.info("Factura %s actualizada desde el SAT", factura_id)
        try:   # la Carta Porte del XML alimenta viajes, choferes, tractos, góndolas y lugares
            rfc = db.table("empresa_configuracion").select("rfc").eq("id", empresa_id).single().execute().data["rfc"]
            res, detalle = registrar_carta_porte(db, Tenant("", empresa_id, rfc), xml, factura_id, LugaresCatalogo(db, empresa_id))
            log.info("Factura %s Carta Porte: %s %s", factura_id, res, detalle)
        except Exception:
            log.exception("Factura %s: no se pudo registrar la Carta Porte", factura_id)
    except (SatError, CFDIError) as exc:
        tabla.update({"estado": "error", "error": str(exc)[:500]}).eq("factura_id", factura_id).execute()
        log.warning("Factura %s: %s", factura_id, exc)
    except Exception as exc:
        log.exception("Factura %s: fallo inesperado consultando al SAT", factura_id)
        tabla.update({"estado": "error", "error": f"Error al consultar el SAT: {type(exc).__name__}"}).eq(
            "factura_id", factura_id).execute()
