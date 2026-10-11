"""Persistencia de un CFDI parseado en Supabase, siempre acotado al tenant."""
from fastapi import HTTPException, status

from .auth import Tenant
from .cfdi_parser import CFDIViaje
from .db import get_admin_client


def _upsert_id(table: str, conflict: str, row: dict) -> str:
    res = get_admin_client().table(table).upsert(row, on_conflict=conflict).execute()
    return res.data[0]["id"]


def guardar_viaje(tenant: Tenant, v: CFDIViaje) -> dict:
    db = get_admin_client()
    eid = tenant.empresa_id

    if tenant.rfc not in (v.rfc_emisor, v.rfc_receptor):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "El CFDI no pertenece a tu empresa (el RFC emisor/receptor no coincide)",
        )

    dup = db.table("viajes").select("id").eq("empresa_id", eid).eq("uuid", v.uuid).limit(1).execute().data
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, f"El CFDI {v.uuid} ya fue procesado")

    # upsert con ignore de duplicados: no pisa kilometraje de un tracto existente
    def ensure(table: str, conflict: str, row: dict) -> str:
        found = db.table(table).select("id")
        for col in conflict.split(","):
            if col != "empresa_id":
                found = found.eq(col, row[col])
        hit = found.eq("empresa_id", eid).limit(1).execute().data
        return hit[0]["id"] if hit else _upsert_id(table, conflict, row)

    tracto_id = ensure("tractocamiones", "empresa_id,placa", {
        "empresa_id": eid, "placa": v.placa_vehiculo, "modelo": v.modelo_vehiculo,
    })
    gondola_id = None
    if v.placa_remolque:
        gondola_id = ensure("gondolas", "empresa_id,placa", {
            "empresa_id": eid, "placa": v.placa_remolque, "subtipo": v.subtipo_remolque,
        })
    chofer_id = ensure("choferes", "empresa_id,rfc", {
        "empresa_id": eid, "rfc": v.chofer_rfc, "nombre": v.chofer_nombre, "licencia": v.chofer_licencia,
    })
    origen_id = ensure("ubicaciones", "empresa_id,id_ubicacion", {
        "empresa_id": eid, **v.origen.__dict__,
    })
    destino_id = ensure("ubicaciones", "empresa_id,id_ubicacion", {
        "empresa_id": eid, **v.destino.__dict__,
    })

    row = {
        "empresa_id": eid,
        "folio_factura": v.folio,
        "uuid": v.uuid,
        "origen_id": origen_id,
        "destino_id": destino_id,
        "distancia_xml": float(v.distancia_xml),
        "distancia_operativa": float(v.distancia_operativa),
        "tracto_id": tracto_id,
        "gondola_id": gondola_id,
        "chofer_id": chofer_id,
        "rfc_emisor": v.rfc_emisor,
        "rfc_receptor": v.rfc_receptor,
        "subtotal": float(v.subtotal),
        "total": float(v.total),
        "fecha": v.fecha.isoformat(),
    }
    try:
        # El trigger trg_viaje_suma_kilometraje actualiza tractocamiones.kilometraje_actual
        res = db.table("viajes").insert(row).execute()
    except Exception as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"No se pudo guardar el viaje: {exc}")
    return res.data[0]
