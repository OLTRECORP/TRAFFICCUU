"""Importación idempotente del Excel de administración de fletes.

Hojas reconocidas (por nombre, sin importar mayúsculas):
  - "LISTA DE FACTURAS"      -> tabla facturas       (clave: empresa + folio)
  - "RELACION DE ORDENES"    -> tabla ordenes_compra (clave: empresa + N° de orden)
Reimportar el mismo archivo (o uno más nuevo) actualiza los registros existentes sin duplicar.
"""
import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from uuid import UUID

from openpyxl import load_workbook

CHUNK = 500
_ORDEN_RE = re.compile(r"^\d+[A-Z]*$")


class ExcelError(ValueError):
    pass


def _norm(s: object) -> str:
    t = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", t).strip().lower()


def _text(v: object) -> str | None:
    if v is None:
        return None
    t = str(v).strip()
    return t or None


def _money(v: object) -> Decimal | None:
    if v is None or isinstance(v, bool) or v == "":
        return None
    try:
        return Decimal(str(v)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


def _date(v: object) -> str | None:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    t = _text(v)
    if not t:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(t[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return None  # p. ej. "NO ASIGNADO"


def _orden(v: object) -> str | None:
    t = (_text(v) or "").upper()
    return t if _ORDEN_RE.match(t) and t.strip("0") else None  # descarta "SIN ORDEN", "0", etc.


def _find_sheet(wb, needle: str):
    for ws in wb.worksheets:
        if needle in _norm(ws.title):
            return ws
    return None


def _rows(ws, required: set[str]):
    """Devuelve (índice de columnas por encabezado normalizado, filas) buscando el encabezado en las primeras filas."""
    it = ws.iter_rows(values_only=True)
    for i, row in enumerate(it):
        cols = {_norm(c): j for j, c in enumerate(row) if c is not None}
        if required <= cols.keys():
            return cols, it
        if i > 15:
            break
    raise ExcelError(f"No se encontraron las columnas esperadas en la hoja '{ws.title}': {', '.join(sorted(required))}")


def _get(row: tuple, cols: dict, name: str):
    j = cols.get(name)
    return row[j] if j is not None and j < len(row) else None


def parse_facturas(ws) -> tuple[list[dict], int, int]:
    """Clave: folio. El UUID se guarda solo si es válido (el Excel trae muchos con caracteres perdidos)."""
    cols, rows = _rows(ws, {"uuid", "total", "folio"})
    out: dict[str, dict] = {}
    uuids: dict[str, str] = {}
    omitidas = danados = 0
    for row in rows:
        folio = _text(_get(row, cols, "folio"))
        raw = _text(_get(row, cols, "uuid"))
        if folio is None:
            if raw is not None:
                omitidas += 1
            continue
        if isinstance(_get(row, cols, "folio"), float) and float(folio).is_integer():
            folio = str(int(float(folio)))
        uid = None
        if raw is not None:
            try:
                uid = str(UUID(raw))
            except ValueError:
                danados += 1
        if uid and uuids.setdefault(uid, folio) != folio:  # mismo UUID en otro folio: se conserva en el primero
            uid = None
        c_pag = _get(row, cols, "c.pag.")
        out[folio] = {  # el último renglón con el mismo folio gana
            "folio": folio,
            "uuid": uid,
            "tipo_comprobante": _text(_get(row, cols, "tipo de comprobante")),
            "estado": (_text(_get(row, cols, "estado")) or "").lower() or None,
            "fecha_emision": _date(_get(row, cols, "fecha de emision")),
            "total": str(_money(_get(row, cols, "total")) or Decimal("0.00")),
            "c_pag": int(c_pag) if isinstance(c_pag, (int, float)) and not isinstance(c_pag, bool) else None,
            "complemento": _text(_get(row, cols, "complemento")),
            "orden_referida": _orden(_get(row, cols, "orden referida")),
            "orden_compra": _orden(_get(row, cols, "orden de compra")),
            "fecha_creacion": _date(_get(row, cols, "fecha de creacion")),
            "fecha_pago": _date(_get(row, cols, "fecha de pago")),
        }
    return list(out.values()), omitidas, danados


def parse_ordenes(ws) -> tuple[list[dict], int]:
    cols, rows = _rows(ws, {"n de orden", "monto"})
    out: dict[str, dict] = {}
    omitidas = 0
    for row in rows:
        num = _orden(_get(row, cols, "n de orden"))
        if num is None:  # renglones de relleno ("-") y totales del pie de la hoja
            if _text(_get(row, cols, "n de orden")):
                omitidas += 1
            continue
        out[num] = {
            "numero": num,
            "monto": str(_money(_get(row, cols, "monto")) or Decimal("0.00")),
            "fecha_creacion": _date(_get(row, cols, "fecha de creacion")),
            "fecha_pago": _date(_get(row, cols, "fecha de pago")),
            "comp_pago": (str(m) if (m := _money(_get(row, cols, "comp pago"))) is not None else None),
        }
    return list(out.values()), omitidas


def parse_workbook(content: bytes) -> dict:
    try:
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise ExcelError("No se pudo leer el archivo. Sube el Excel (.xlsx) de administración de fletes")
    ws_f = _find_sheet(wb, "lista de facturas")
    ws_o = _find_sheet(wb, "relacion de ordenes")
    if ws_f is None and ws_o is None:
        raise ExcelError("El archivo no tiene las hojas 'LISTA DE FACTURAS' ni 'RELACION DE ORDENES'")
    facturas, f_om, danados = parse_facturas(ws_f) if ws_f is not None else ([], 0, 0)
    ordenes, o_om = parse_ordenes(ws_o) if ws_o is not None else ([], 0)
    return {"facturas": facturas, "ordenes": ordenes, "omitidas": f_om + o_om, "uuid_danados": danados}


def _alinear_facturas(db, empresa_id: str, rows: list[dict]) -> int:
    """Antes de guardar: las facturas que ya existen (p. ej. creadas al subir su XML) se reconocen por UUID, o por
    folio y total, y el renglón del Excel pasa a actualizarlas en vez de duplicarlas. Un UUID válido que ya tiene la
    factura no se borra si el Excel lo trae dañado. Devuelve cuántos renglones se alinearon a una factura existente."""
    from .descarga_masiva import normalizar_folio   # import tardío: solo se necesita al guardar facturas

    existentes: list[dict] = []
    for a in range(0, 10**9, 1000):
        lote = (db.table("facturas").select("*").eq("empresa_id", empresa_id).order("id").range(a, a + 999).execute().data or [])
        existentes.extend(lote)
        if len(lote) < 1000:
            break
    por_folio = {str(f["folio"]): f for f in existentes}
    por_uuid = {str(f["uuid"]).lower(): f for f in existentes if f.get("uuid")}
    por_norm: dict[str, list[dict]] = {}
    for f in existentes:
        por_norm.setdefault(normalizar_folio(f["folio"]), []).append(f)

    usadas: set[str] = set()
    alineadas = 0
    for row in rows:
        f = por_folio.get(row["folio"]) or (por_uuid.get(row["uuid"].lower()) if row.get("uuid") else None)
        if f is None:
            total = Decimal(row["total"])
            cand = [c for c in por_norm.get(normalizar_folio(row["folio"]), [])
                    if c["id"] not in usadas and not (c.get("uuid") and row.get("uuid") and c["uuid"].lower() != row["uuid"].lower())
                    and abs(Decimal(str(c["total"])) - total) <= Decimal("0.01")]
            f = cand[0] if len(cand) == 1 else None
        if f is None or f["id"] in usadas:
            continue
        usadas.add(f["id"])
        if row["folio"] != f["folio"]:
            alineadas += 1
            row["folio"] = f["folio"]
        if not row.get("uuid") and f.get("uuid"):
            row["uuid"] = f["uuid"]
        for k in ("tipo_comprobante", "fecha_emision"):   # lo que el Excel no trae se conserva del XML
            if row.get(k) is None:
                row[k] = f.get(k)
    return alineadas


def guardar(db, empresa_id: str, parsed: dict) -> dict:
    """Upsert en bloques acotado a la empresa. Cuenta altas vs. actualizaciones."""
    res = {}
    for table, key, rows in (
        ("ordenes_compra", "numero", parsed["ordenes"]),
        ("facturas", "folio", parsed["facturas"]),
    ):
        if table == "facturas":
            _alinear_facturas(db, empresa_id, rows)
        existentes: set[str] = set()
        for i in range(0, len(rows), CHUNK):
            keys = [r[key] for r in rows[i : i + CHUNK]]
            found = db.table(table).select(key).eq("empresa_id", empresa_id).in_(key, keys).execute().data
            existentes |= {str(f[key]) for f in found}
        for i in range(0, len(rows), CHUNK):
            batch = [{**r, "empresa_id": empresa_id} for r in rows[i : i + CHUNK]]
            db.table(table).upsert(batch, on_conflict=f"empresa_id,{key}").execute()
        nuevas = sum(1 for r in rows if r[key] not in existentes)
        res[table] = {"total": len(rows), "nuevas": nuevas, "actualizadas": len(rows) - nuevas}
    return res
