"""Facturas semanales: clientes cuya factura agrupa los viajes de lunes a domingo (sin importar chofer, tracto o
destino), p. ej. Pétreos La Purísima. Se reconoce la factura por el RFC o el nombre del receptor en su XML y se
liga a la semana cuyo subtotal de viajes coincide con el de la factura (±$1). Lo que no cuadra se deja para
ligarlo a mano desde el portal, con la diferencia a la vista."""
import logging
from collections import defaultdict
from datetime import date, timedelta

from .nombres import normalizar
from .remisiones_excel import lunes

log = logging.getLogger("semanal")

TOLERANCIA = 1.0          # pesos de diferencia aceptados entre la factura y la semana
DIAS_ANTES = 2            # la factura puede emitirse desde el sábado de la misma semana
DIAS_DESPUES = 75         # ... y hasta ~2 meses después de que cerró


def es_del_cliente(cliente: dict, rfc: str | None, nombre: str | None) -> bool:
    if cliente.get("rfc") and rfc and cliente["rfc"].strip().upper() == rfc.strip().upper():
        return True
    n = normalizar(nombre)
    if not n:
        return False
    return any(normalizar(a) and normalizar(a) in n for a in [cliente["nombre"], *(cliente.get("alias") or [])])


def cliente_semanal(db, empresa_id: str, rfc: str | None, nombre: str | None) -> dict | None:
    """Cliente con factura semanal al que pertenece un receptor, o None."""
    for c in db.table("clientes").select("*").eq("empresa_id", empresa_id).eq("factura_semanal", True).execute().data or []:
        if es_del_cliente(c, rfc, nombre):
            return c
    return None


def facturas_del_cliente(db, empresa_id: str, cliente: dict) -> list[dict]:
    """Facturas de ingreso con XML cuyo receptor es el cliente: id, folio, fecha, subtotal, total, estado, rfc."""
    sat = _leer_sat(db, empresa_id)
    propias = {}
    for s in sat:
        rec = s.get("receptor") or {}
        if s.get("tipo_comprobante") not in (None, "I"):
            continue
        if es_del_cliente(cliente, rec.get("rfc"), rec.get("nombre")):
            propias[s["factura_id"]] = s
    if not propias:
        return []
    out = []
    ids = list(propias)
    for i in range(0, len(ids), 200):
        for f in db.table("facturas").select("id, folio, fecha_emision, total, estado").in_("id", ids[i:i + 200]).execute().data or []:
            if f.get("estado") == "cancelado":
                continue
            s = propias[f["id"]]
            fecha = (s.get("fecha") or f.get("fecha_emision") or "")[:10]
            out.append({"id": f["id"], "folio": f["folio"], "fecha": fecha or None, "estado": f.get("estado"),
                        "subtotal": float(s["subtotal"]) if s.get("subtotal") not in (None, "") else None,
                        "total": float(f["total"] or 0), "rfc": (s.get("receptor") or {}).get("rfc")})
    return sorted(out, key=lambda f: (f["fecha"] or "", f["folio"]))


def _leer_sat(db, empresa_id: str) -> list[dict]:
    filas, desde = [], 0
    while True:
        lote = (db.table("facturas_sat")
                .select("factura_id, receptor:datos->receptor, subtotal:datos->>subtotal, fecha:datos->>fecha, tipo_comprobante:datos->>tipo_comprobante")
                .eq("empresa_id", empresa_id).eq("estado", "ok").order("factura_id").range(desde, desde + 999).execute().data or [])
        filas += lote
        if len(lote) < 1000:
            return filas
        desde += 1000


def semanas_del_cliente(db, empresa_id: str, cliente_id: str) -> list[dict]:
    """Semanas (lunes a domingo) con sus viajes: subtotal, cantidad y facturas ligadas; la más reciente primero."""
    viajes, desde = [], 0
    while True:
        lote = (db.table("viajes").select("id, fecha, subtotal, cantidad, factura_id").eq("empresa_id", empresa_id)
                .eq("cliente_id", cliente_id).order("id").range(desde, desde + 999).execute().data or [])
        viajes += lote
        if len(lote) < 1000:
            break
        desde += 1000
    sem: dict[date, dict] = defaultdict(lambda: {"viajes": 0, "subtotal": 0.0, "cantidad": 0.0, "facturas": defaultdict(int), "sin_factura": 0})
    for v in viajes:
        d = date.fromisoformat(v["fecha"][:10])
        s = sem[lunes(d)]
        s["viajes"] += 1
        s["subtotal"] += float(v["subtotal"] or 0)
        s["cantidad"] += float(v["cantidad"] or 0)
        if v["factura_id"]:
            s["facturas"][v["factura_id"]] += 1
        else:
            s["sin_factura"] += 1
    return [{"semana": k.isoformat(), "fin": (k + timedelta(days=6)).isoformat(), "viajes": s["viajes"],
             "subtotal": round(s["subtotal"], 2), "cantidad": round(s["cantidad"], 3),
             "facturas": dict(s["facturas"]), "sin_factura": s["sin_factura"]}
            for k, s in sorted(sem.items(), reverse=True)]


def emparejar(semanas: list[dict], facturas: list[dict]) -> list[tuple[dict, dict]]:
    """Pares (factura, semana) por monto: semana sin factura, cerrada cerca de la fecha de la factura y con el mismo
    subtotal (±TOLERANCIA). Si varias semanas cuadran se toma la más cercana a la factura. Función pura."""
    ligadas = {fid for s in semanas for fid in s["facturas"]}
    libres = [s for s in semanas if not s["facturas"]]
    pares = []
    for f in sorted(facturas, key=lambda f: f["fecha"] or ""):
        if f["id"] in ligadas or f["subtotal"] is None or not f["fecha"]:
            continue
        ff = date.fromisoformat(f["fecha"])
        cands = [s for s in libres
                 if abs(s["subtotal"] - f["subtotal"]) <= TOLERANCIA
                 and date.fromisoformat(s["fin"]) - timedelta(days=DIAS_ANTES) <= ff <= date.fromisoformat(s["fin"]) + timedelta(days=DIAS_DESPUES)]
        if not cands:
            continue
        s = min(cands, key=lambda s: abs((ff - date.fromisoformat(s["fin"])).days))
        pares.append((f, s))
        libres.remove(s)
    return pares


def ligar_semana(db, empresa_id: str, cliente_id: str, semana: str, factura: dict | None) -> int:
    """Liga (o desliga con factura=None) todos los viajes del cliente de esa semana. Devuelve cuántos cambió."""
    ini = date.fromisoformat(semana)
    if ini.weekday() != 0:
        raise ValueError("La semana debe empezar en lunes")
    q = (db.table("viajes").update({"factura_id": factura["id"] if factura else None, "folio_factura": factura["folio"] if factura else None})
         .eq("empresa_id", empresa_id).eq("cliente_id", cliente_id)
         .gte("fecha", f"{ini.isoformat()}T00:00:00+00:00").lt("fecha", f"{(ini + timedelta(days=7)).isoformat()}T00:00:00+00:00"))
    return len(q.execute().data or [])


def ligar_auto(db, empresa_id: str, cliente: dict) -> dict:
    """Liga por monto las facturas del cliente que aún no tienen viajes. Aprende el RFC del cliente si no lo tenía."""
    facturas = facturas_del_cliente(db, empresa_id, cliente)
    semanas = semanas_del_cliente(db, empresa_id, cliente["id"])
    pares = emparejar(semanas, facturas)
    ligados = []
    for f, s in pares:
        n = ligar_semana(db, empresa_id, cliente["id"], s["semana"], f)
        ligados.append({"folio": f["folio"], "semana": s["semana"], "viajes": n, "subtotal": f["subtotal"]})
    if not cliente.get("rfc"):
        rfcs = {f["rfc"] for f in facturas if f.get("rfc")}
        if len(rfcs) == 1:
            db.table("clientes").update({"rfc": rfcs.pop()}).eq("id", cliente["id"]).execute()
    usadas = {fid for s in semanas for fid in s["facturas"]} | {f["id"] for f, _ in pares}
    log.info("Facturas semanales %s: %d ligadas", cliente["nombre"], len(ligados))
    return {"ligadas": ligados, "facturas": len(facturas),
            "facturas_sin_semana": [f for f in facturas if f["id"] not in usadas]}


def ligar_todos(db, empresa_id: str) -> int:
    """Para correr al final de una descarga del SAT o de subir XML: liga por monto en todos los clientes semanales."""
    total = 0
    for c in db.table("clientes").select("*").eq("empresa_id", empresa_id).eq("factura_semanal", True).execute().data or []:
        try:
            total += len(ligar_auto(db, empresa_id, c)["ligadas"])
        except Exception:
            log.exception("No se pudieron ligar las facturas semanales de %s", c["nombre"])
    return total
