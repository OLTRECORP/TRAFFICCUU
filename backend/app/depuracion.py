"""Eliminar facturas y unificar tractos/góndolas duplicados. La lógica vive en funciones de Postgres (migración 017)
para que cada operación sea atómica y quede respaldada en `auditoria_eliminaciones`."""
from fastapi import HTTPException, status

from .db import get_admin_client

MAX_FACTURAS = 200


def _rpc(nombre: str, args: dict) -> dict:
    try:
        return get_admin_client().rpc(nombre, args).execute().data
    except Exception as exc:
        texto = str(exc)
        if "PGRST202" in texto or "Could not find the function" in texto or "does not exist" in texto:
            mig = "023_unificar_clientes.sql" if "clientes" in nombre else "017_eliminar_facturas_unificar_unidades.sql"
            raise HTTPException(status.HTTP_409_CONFLICT, f"Falta ejecutar la migración {mig[:3]} en Supabase (supabase/migrations/{mig})")
        # los RAISE EXCEPTION de las funciones llegan con su mensaje en español
        msg = getattr(exc, "message", None) or texto
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(msg)[:300])


def _ids(ids: list) -> list[str]:
    unicos = list(dict.fromkeys(str(i) for i in ids))
    if not unicos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No hay facturas seleccionadas")
    if len(unicos) > MAX_FACTURAS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Máximo {MAX_FACTURAS} facturas por vez")
    return unicos


def vista_previa_eliminar(empresa_id: str, ids: list) -> dict:
    return _rpc("fn_vista_previa_eliminar_facturas", {"p_empresa": empresa_id, "p_ids": _ids(ids)})


def eliminar_facturas(empresa_id: str, usuario_id: str, ids: list, motivo: str | None) -> dict:
    return _rpc("fn_eliminar_facturas", {"p_empresa": empresa_id, "p_ids": _ids(ids), "p_motivo": motivo or "", "p_usuario": usuario_id})


def vista_previa_unificar(empresa_id: str, tipo: str, origen: str, destino: str) -> dict:
    return _rpc("fn_vista_previa_unificar", {"p_empresa": empresa_id, "p_tipo": tipo, "p_origen": origen, "p_destino": destino})


def unificar(empresa_id: str, usuario_id: str, tipo: str, origen: str, destino: str) -> dict:
    return _rpc("fn_unificar_unidad", {"p_empresa": empresa_id, "p_tipo": tipo, "p_origen": origen, "p_destino": destino, "p_usuario": usuario_id})


def vista_previa_unificar_clientes(empresa_id: str, origen: str, destino: str) -> dict:
    return _rpc("fn_vista_previa_unificar_clientes", {"p_empresa": empresa_id, "p_origen": origen, "p_destino": destino})


def unificar_clientes(empresa_id: str, usuario_id: str, origen: str, destino: str) -> dict:
    return _rpc("fn_unificar_clientes", {"p_empresa": empresa_id, "p_origen": origen, "p_destino": destino, "p_usuario": usuario_id})


def unidad_por_alias(db, empresa_id: str, tipo: str, placa: str) -> str | None:
    """Id de la unidad a la que se unificó una placa errónea; None si no hay alias (o aún no existe la tabla)."""
    try:
        r = (db.table("unidad_alias").select("unidad_id").eq("empresa_id", empresa_id).eq("tipo", tipo).eq("placa", placa)
             .limit(1).execute().data)
    except Exception:
        return None
    return r[0]["unidad_id"] if r else None
