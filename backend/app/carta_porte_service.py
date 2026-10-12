"""Carta Porte de los XML descargados: por cada XML de una factura registra el viaje (uno por factura) con su
chofer, tractocamión, góndola, origen y destino, y suma los km al tracto. Todo sale del propio CFDI."""
import logging

from fastapi import HTTPException

from .auth import Tenant
from .cfdi_parser import CFDIError, parse_cfdi
from .db import get_admin_client
from .rutas_service import LugaresCatalogo
from .viajes_service import guardar_viaje

log = logging.getLogger("carta_porte")


def registrar(db, tenant: Tenant, xml: bytes, factura_id: str | None, catalogo: LugaresCatalogo) -> tuple[str, str]:
    """(resultado, detalle). resultado: creado | existente | sin_carta_porte | error."""
    try:
        cfdi = parse_cfdi(xml)
    except CFDIError as exc:
        return "sin_carta_porte", str(exc)
    existente = db.table("viajes").select("id, factura_id").eq("empresa_id", tenant.empresa_id).eq("uuid", cfdi.uuid.lower()).limit(1).execute().data
    if existente:
        if factura_id and not existente[0].get("factura_id"):
            db.table("viajes").update({"factura_id": factura_id}).eq("id", existente[0]["id"]).execute()
        return "existente", f"El viaje del CFDI {cfdi.uuid[:8]}… ya estaba registrado"
    try:
        viaje = guardar_viaje(tenant, cfdi, factura_id, catalogo)
    except HTTPException as exc:
        return "error", str(exc.detail)
    except Exception as exc:
        log.exception("No se pudo guardar el viaje del CFDI %s", cfdi.uuid)
        return "error", f"{type(exc).__name__}: {str(exc)[:200]}"
    return "creado", (
        f"Viaje {cfdi.folio or cfdi.uuid[:8]}: chofer {cfdi.chofer_nombre}, tracto {cfdi.placa_vehiculo}"
        f"{', góndola ' + cfdi.placa_remolque if cfdi.placa_remolque else ''}, "
        f"{cfdi.origen.nombre or cfdi.origen.municipio} → {cfdi.destino.nombre or cfdi.destino.municipio}, "
        f"{cfdi.distancia_xml} km"
    )
