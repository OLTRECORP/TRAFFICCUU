import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


def _fernet() -> Fernet:
    # FERNET_KEY puede ser cualquier cadena secreta larga (p. ej. la que genera Render);
    # se deriva una llave Fernet válida de 32 bytes con SHA-256.
    digest = hashlib.sha256(get_settings().fernet_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("No se pudo descifrar el secreto (FERNET_KEY incorrecta)") from exc
