"""Persistencia de un CFDI parseado en Supabase, siempre acotado al tenant."""
from fastapi import HTTPException, status

from .auth import Tenant
from .cfdi_parser import CFDIViaje, UbicacionData
from .db import get_admin_client
from .rutas_service import LugaresCatalogo, _norm


def _upsert_id(table: str, conflict: str, row: dict) -> str:
    res = get_admin_client().table(table).upsert(row, on_conflict=conflict).execute()
    return res.data[0]["id"]


def _ubicacion_row(u: UbicacionData) -> dict:
    """Fila de `ubicaciones`. El IDUbicacion de la Carta Porte (OR000001/DE000001) se repite en casi todos
    los viajes, así que se le agrega el lugar para que cada origen/destino distinto sea un registro distinto."""
    lugar = _norm(u.nombre or u.municipio)
    return {
        "id_ubicacion": f"{u.id_ubicacion}|{lugar}" if lugar else u.id_ubicacion,
        "nombre": u.nombre, "municipio": u.municipio, "estado": u.estado,
    }


def _completar(db, tabla: str, fila_id: str, datos: dict) -> None:
    """Completa solo los campos vacíos de una ficha existente; nunca pisa lo capturado a mano."""
    datos = {k: val for k, val in datos.items() if val not in (None, "")}
    if not datos:
        return
    actual = db.table(tabla).select(",".join(datos)).eq("id", fila_id).limit(1).execute().data
    if not actual:
        return
    faltan = {k: val for k, val in datos.items() if actual[0].get(k) in (None, "")}
    if faltan:
        db.table(tabla).update(faltan).eq("id", fila_id).execute()


def guardar_viaje(tenant: Tenant, v: CFDIViaje, factura_id: str | None = None, catalogo: LugaresCatalogo | None = None) -> dict:
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
    # Ficha del tracto desde la Carta Porte: solo llena lo que esté vacío. El PesoBrutoTotal se toma como capacidad.
    _completar(db, "tractocamiones", tracto_id, {
        "anio": int(v.modelo_vehiculo) if (v.modelo_vehiculo or "").isdigit() else None,
        "config_vehicular": v.configuracion_vehicular, "tipo_permiso_sct": v.tipo_permiso_sct,
        "num_permiso_sct": v.num_permiso_sct, "aseguradora": v.aseguradora, "poliza_seguro": v.poliza_seguro,
        "capacidad_kg": float(v.peso_bruto_total_kg) if v.peso_bruto_total_kg else None,
    })
    gondola_id = None
    if v.placa_remolque:
        gondola_id = ensure("gondolas", "empresa_id,placa", {
            "empresa_id": eid, "placa": v.placa_remolque, "subtipo": v.subtipo_remolque,
        })
        # La Carta Porte declara permiso y seguro del autotransporte completo (tracto + remolque).
        _completar(db, "gondolas", gondola_id, {
            "tipo_permiso_sct": v.tipo_permiso_sct, "num_permiso_sct": v.num_permiso_sct,
            "aseguradora": v.aseguradora, "poliza_seguro": v.poliza_seguro,
        })
    chofer_id = ensure("choferes", "empresa_id,rfc", {
        "empresa_id": eid, "rfc": v.chofer_rfc, "nombre": v.chofer_nombre, "licencia": v.chofer_licencia,
    })
    origen_id = ensure("ubicaciones", "empresa_id,id_ubicacion", {"empresa_id": eid, **_ubicacion_row(v.origen)})
    destino_id = ensure("ubicaciones", "empresa_id,id_ubicacion", {"empresa_id": eid, **_ubicacion_row(v.destino)})

    # Un viaje por factura (se liga por UUID) y origen/destino del catálogo de lugares (se crean si no existen).
    if factura_id is None:
        fac = db.table("facturas").select("id").eq("empresa_id", eid).eq("uuid", v.uuid.lower()).limit(1).execute().data
        factura_id = fac[0]["id"] if fac else None
    catalogo = catalogo or LugaresCatalogo(db, eid)

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
        "factura_id": factura_id,
        "lugar_origen_id": catalogo.asegurar(v.origen, "origen"),
        "lugar_destino_id": catalogo.asegurar(v.destino, "destino", v.precio_tonelada),
        "toneladas_facturadas": float(v.toneladas_facturadas) if v.toneladas_facturadas is not None else None,
        "precio_tonelada": float(v.precio_tonelada) if v.precio_tonelada is not None else None,
        "peso_bruto_total_kg": float(v.peso_bruto_total_kg) if v.peso_bruto_total_kg is not None else None,
        "mercancia": v.mercancia,
        "fecha_salida": v.origen.fecha.isoformat() if v.origen.fecha else None,
        "fecha_llegada": v.destino.fecha.isoformat() if v.destino.fecha else None,
    }
    try:
        # El trigger trg_viaje_suma_kilometraje actualiza tractocamiones.kilometraje_actual
        res = db.table("viajes").insert(row).execute()
    except Exception as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"No se pudo guardar el viaje: {exc}")
    return res.data[0]
