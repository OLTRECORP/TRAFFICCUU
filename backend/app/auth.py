from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import get_admin_client

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Tenant:
    user_id: str
    empresa_id: str
    rfc: str


@dataclass(frozen=True)
class CurrentUser:
    user_id: str


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> CurrentUser:
    """Valida el JWT de Supabase Auth contra el servidor de Auth."""
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta el token de autenticación")
    try:
        res = get_admin_client().auth.get_user(cred.credentials)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido o expirado")
    if res is None or res.user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido o expirado")
    return CurrentUser(user_id=res.user.id)


def current_tenant(user: CurrentUser = Depends(current_user)) -> Tenant:
    rows = (
        get_admin_client()
        .table("empresa_configuracion")
        .select("id, rfc")
        .eq("user_id", user.user_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Configura los datos de tu empresa en /settings antes de continuar",
        )
    return Tenant(user_id=user.user_id, empresa_id=rows[0]["id"], rfc=rows[0]["rfc"])
