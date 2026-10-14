"""Carta Porte de los XML descargados: por cada XML de una factura registra el viaje (uno por factura) con su
chofer, tractocamión, góndola, origen y destino, y suma los km al tracto. Todo sale del propio CFDI."""
import logging

from fastapi import HTTPException

from .auth import Tenant
from .cfdi_parser import CFDIError, parse_cfdi, resumen_cfdi
from .db import get_admin_client
from .rutas_service import LugaresCatalogo
from .semanal import cliente_semanal
from .viajes_service import guardar_viaje

log = logging.getLogger("carta_porte")


def registrar(db, tenant: Tenant, xml: bytes, factura_id: str | None, catalogo: LugaresCatalogo) -> tuple[str, str]:
    """(resultado, detalle). resultado: creado | existente | sin_carta_porte | error."""
    try:
        cfdi = parse_cfdi(xml)
    except CFDIError as exc:
        return "sin_carta_porte", str(exc)
    # La factura semanal de un cliente (p. ej. La Purísima) no es un viaje: agrupa los de su semana y se liga después.
    try:
        receptor = resumen_cfdi(xml).get("receptor") or {}
        semanal = cliente_semanal(db, tenant.empresa_id, receptor.get("rfc"), receptor.get("nombre"))
    except Exception:   # migración 022 aún sin aplicar
        semanal = None
    if semanal:
        return "omitido", f"Factura semanal de {semanal['nombre']}: se liga a los viajes de su semana, no crea un viaje"
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
    extras = list(catalogo.avisos)
    catalogo.avisos.clear()
    try:
        sp = db.table("viajes_sobrepeso").select("exceso_kg, capacidad_kg").eq("viaje_id", viaje["id"]).limit(1).execute().data
    except Exception:   # vista de la migración 012 aún sin crear
        sp = []
    if sp:
        extras.append(f"Posible sobrepeso: {cfdi.toneladas_facturadas} t facturadas contra capacidad de {float(sp[0]['capacidad_kg']) / 1000:g} t "
                      f"(exceso {float(sp[0]['exceso_kg']):g} kg)")
    return "creado", (
        f"Viaje {cfdi.folio or cfdi.uuid[:8]}: chofer {cfdi.chofer_nombre}, tracto {cfdi.placa_vehiculo}"
        f"{', góndola ' + cfdi.placa_remolque if cfdi.placa_remolque else ''}, "
        f"{cfdi.origen.nombre or cfdi.origen.municipio} → {cfdi.destino.nombre or cfdi.destino.municipio}, "
        f"{cfdi.distancia_xml} km" + "".join(f". {e}" for e in extras)
    )
