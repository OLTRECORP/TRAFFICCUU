"""Comparación tolerante de nombres capturados a mano (lugares, choferes): sin acentos ni mayúsculas, sin artículos
(«LA RUMOROSA» = «RUMOROSA») y con una letra de diferencia en palabras largas («CRIVA» = «CRIBA»).
Una coincidencia parcial («SIMON BOLIVAR» dentro de «HOLCIM SIMON BOLIVAR») solo cuenta si es única."""
import re
import unicodedata

VACIAS = {"la", "el", "los", "las", "de", "del", "y"}


def normalizar(texto: str | None) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def palabras(texto: str | None) -> frozenset[str]:
    return frozenset(p for p in normalizar(texto).split() if p not in VACIAS)


def _una_letra(a: str, b: str) -> bool:
    """Distancia de edición <= 1 (sustitución, inserción o borrado)."""
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    i = j = dif = 0
    while i < len(a) and j < len(b):
        if a[i] != b[j]:
            dif += 1
            if dif > 1:
                return False
            if len(a) == len(b):
                i += 1
            j += 1
        else:
            i += 1
            j += 1
    return dif + (len(b) - j) <= 1


def _palabra_igual(a: str, b: str) -> bool:
    return a == b or (min(len(a), len(b)) >= 5 and _una_letra(a, b))


def _contenido(chico: frozenset[str], grande: frozenset[str]) -> bool:
    return all(any(_palabra_igual(p, q) for q in grande) for p in chico)


def parecido(a: frozenset[str], b: frozenset[str], minimo: int = 1) -> bool:
    """Mismas palabras (tolerando una letra) o unas contenidas en las otras, con al menos `minimo` palabras."""
    if not a or not b:
        return False
    chico, grande = (a, b) if len(a) <= len(b) else (b, a)
    return len(chico) >= minimo and _contenido(chico, grande)


class Indice:
    """Catálogo de nombres -> id. `buscar` devuelve (id, tipo) con tipo 'igual' | 'parecido', o (None, motivo)."""

    def __init__(self, minimo_parcial: int = 1):
        self.exactos: dict[frozenset[str], set[str]] = {}
        self.items: list[tuple[frozenset[str], str]] = []
        self.minimo_parcial = minimo_parcial

    def agregar(self, nombre: str | None, ident: str) -> None:
        p = palabras(nombre)
        if not p:
            return
        self.exactos.setdefault(p, set()).add(ident)
        self.items.append((p, ident))

    def buscar(self, nombre: str | None) -> tuple[str | None, str]:
        p = palabras(nombre)
        if not p:
            return None, "vacio"
        exacto = self.exactos.get(p)
        if exacto and len(exacto) == 1:
            return next(iter(exacto)), "igual"
        if exacto:
            return None, "ambiguo"
        candidatos = {ident for q, ident in self.items if parecido(p, q, self.minimo_parcial)}
        if len(candidatos) == 1:
            return candidatos.pop(), "parecido"
        return None, "ambiguo" if candidatos else "nuevo"
