from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    fernet_key: str
    cors_origins: str = "http://localhost:3000"
    max_xml_bytes: int = 5 * 1024 * 1024
    max_excel_bytes: int = 15 * 1024 * 1024
    max_zip_bytes: int = 25 * 1024 * 1024
    # Mapa: OpenStreetMap (Nominatim para direcciones, OSRM para distancia por carretera). Sin llave.
    # Apunta a tu propio servidor o a otro proveedor compatible si el uso público no alcanza.
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    osrm_url: str = "https://router.project-osrm.org"
    maps_user_agent: str = "ERP-Logistico/1.0 (contacto: configura MAPS_USER_AGENT)"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
