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


def _todo(consulta) -> list[dict]:
    filas: list[dict] = []
    desde = 0
    while True:
        lote = consulta(desde, desde + 999).data or []
        filas.extend(lote)
        if len(lote) < 1000:
            return filas
        desde += 1000


def asignar_clientes_desde_xml(db, empresa_id: str, rfc_empresa: str | None, factura_ids: list[str] | None = None,
                               limite: int = 1500) -> dict:
    """Pone en cada viaje que nació de un XML el cliente que dice su RECEPTOR (RFC y nombre del CFDI). Cubre los viajes que
    no pasaron por la carga normal: restaurados de la bitácora, ya existentes cuando se subió de nuevo el XML o creados antes de
    que el cliente saliera del receptor. Solo toca viajes con factura y XML guardado; los del Excel no se tocan."""
    q = lambda a, b: (db.table("viajes").select("id, factura_id, cliente_id, rfc_receptor")  # noqa: E731
                      .eq("empresa_id", empresa_id).eq("origen_registro", "xml").not_.is_("factura_id", "null")
                      .order("fecha", desc=True).order("id").range(a, b).execute())
    try:
        viajes = _todo(q)
    except Exception:   # migración 022 aún sin aplicar
        return {"revisados": 0, "asignados": 0, "pendientes": 0}
    if factura_ids is not None:
        pedidas = set(factura_ids)
        viajes = [v for v in viajes if v["factura_id"] in pedidas]
    pendientes = max(0, len(viajes) - limite)
    viajes = viajes[:limite]
    receptores: dict[str, dict] = {}
    ids = list({v["factura_id"] for v in viajes})
    for i in range(0, len(ids), 100):
        for s in db.table("facturas_sat").select("factura_id, receptor:datos->receptor").in_("factura_id", ids[i:i + 100]).execute().data or []:
            receptores[s["factura_id"]] = s.get("receptor") or {}
    cache: dict[tuple[str, str], str | None] = {}
    asignados = 0
    for v in viajes:
        rec = receptores.get(v["factura_id"])
        if rec is None:
            continue   # sin XML guardado no hay receptor que consultar
        rfc, nombre = (rec.get("rfc") or v.get("rfc_receptor") or "").strip().upper(), (rec.get("nombre") or "").strip()
        clave = (rfc, nombre)
        if clave not in cache:
            cache[clave] = cliente_para_viaje(db, empresa_id, rfc, nombre or None, None, rfc_empresa)
        nuevo = cache[clave]
        if nuevo and nuevo != v.get("cliente_id"):
            db.table("viajes").update({"cliente_id": nuevo}).eq("id", v["id"]).execute()
            asignados += 1
    return {"revisados": len(viajes), "asignados": asignados, "pendientes": pendientes}
