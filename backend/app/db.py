from functools import lru_cache

from supabase import Client, create_client

from .config import get_settings


@lru_cache
def get_admin_client() -> Client:
    """Cliente con service_role: ignora RLS. Toda consulta DEBE filtrar por empresa_id."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)
