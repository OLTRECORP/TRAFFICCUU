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
    # Ruta para camión de carga (Valhalla, perfil «truck»: respeta restricciones de altura, peso y vías para camión).
    # Si no responde se usa OSRM (perfil auto) y el tiempo se ajusta con `factor_tiempo_camion`.
    valhalla_url: str = "https://valhalla1.openstreetmap.de"
    factor_tiempo_camion: float = 1.25
    # Tractocamión con góndola (m, toneladas); T3-S2-R4 máx. 4.25 m de alto y 2.60 m de ancho en México.
    camion_alto_m: float = 4.25
    camion_ancho_m: float = 2.6
    camion_largo_m: float = 18.3
    camion_peso_ton: float = 40.0
    maps_user_agent: str = "ERP-Logistico/1.0 (contacto: configura MAPS_USER_AGENT)"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
