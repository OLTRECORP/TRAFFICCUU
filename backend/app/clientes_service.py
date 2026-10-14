"""Cliente de un viaje que sale de un XML: por RFC del receptor (si el cliente lo tiene) o por el nombre del
destinatario de la Carta Porte (el mismo que guarda `lugares.cliente`); se crea si no existe."""
from .nombres import normalizar


def cliente_para_viaje(db, empresa_id: str, rfc_receptor: str | None, nombre_destino: str | None) -> str | None:
    try:
        clientes = db.table("clientes").select("id, nombre, rfc, alias").eq("empresa_id", empresa_id).execute().data or []
    except Exception:   # migración 022 aún sin aplicar: el viaje se guarda sin cliente
        return None
    if rfc_receptor:
        for c in clientes:
            if (c.get("rfc") or "").strip().upper() == rfc_receptor.strip().upper():
                return c["id"]
    nombre = (nombre_destino or "").strip()
    if not nombre:
        return None
    n = normalizar(nombre)
    for c in clientes:
        if n in {normalizar(x) for x in [c["nombre"], *(c.get("alias") or [])]}:
            return c["id"]
    return db.table("clientes").insert({"empresa_id": empresa_id, "nombre": nombre}).execute().data[0]["id"]
