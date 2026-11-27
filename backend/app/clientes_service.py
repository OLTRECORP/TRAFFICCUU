"""Cliente de un viaje que sale de un XML: es el RECEPTOR de la factura, identificado por su RFC (y su nombre).
Se busca por RFC; si no, por nombre/alias (y se le completa el RFC); si no existe se crea con el nombre y RFC del
receptor. Solo cuando la empresa es la receptora (no hay cliente que facturar) o el XML no trae receptor útil se usa
el nombre del destinatario de la Carta Porte."""
from .nombres import normalizar


def cliente_para_viaje(db, empresa_id: str, rfc_receptor: str | None, nombre_receptor: str | None = None,
                       nombre_destino: str | None = None, rfc_empresa: str | None = None) -> str | None:
    try:
        clientes = db.table("clientes").select("id, nombre, rfc, alias").eq("empresa_id", empresa_id).execute().data or []
    except Exception:   # migración 022 aún sin aplicar: el viaje se guarda sin cliente
        return None
    rfc = (rfc_receptor or "").strip().upper()
    es_la_empresa = bool(rfc) and rfc == (rfc_empresa or "").strip().upper()
    # RFC genéricos del SAT (público en general / extranjero) no identifican a un cliente
    if es_la_empresa or rfc in ("XAXX010101000", "XEXX010101000"):
        rfc, nombre_receptor = "", None
    if rfc:
        for c in clientes:
            if (c.get("rfc") or "").strip().upper() == rfc:
                return c["id"]

    nombre = (nombre_receptor or "").strip() or (nombre_destino or "").strip()
    if not nombre:
        return None
    n = normalizar(nombre)
    for c in clientes:
        if n in {normalizar(x) for x in [c["nombre"], *(c.get("alias") or [])]}:
            if rfc and not (c.get("rfc") or "").strip():
                db.table("clientes").update({"rfc": rfc}).eq("id", c["id"]).execute()
            return c["id"]
    fila = {"empresa_id": empresa_id, "nombre": nombre}
    if rfc:
        fila["rfc"] = rfc
    return db.table("clientes").insert(fila).execute().data[0]["id"]
