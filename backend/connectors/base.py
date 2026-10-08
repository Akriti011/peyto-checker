"""Common result type + retry helper used by every connector."""
import re
import time
from dataclasses import dataclass, field


@dataclass
class Lookup:
    """Answer of one 'find CKT ID for this LSI' attempt."""
    source: str                                  # chitragupt | ssh
    status: str                                  # found | not_found | error
    ckt_ids: list = field(default_factory=list)
    note: str = ""
    detail: dict = field(default_factory=dict)   # e.g. {"node": "T3 202.123.1.1"}
    ms: float = 0.0

    @property
    def found(self):
        return self.status == "found" and bool(self.ckt_ids)


class ConnectorError(Exception):
    """A system could not be reached / answered badly. Retried, then reported as 'error'."""


class ConfigError(ConnectorError):
    """Something is missing in .env / config. Retrying will not help, so it is not retried."""


def extract_ckts(text: str, regex: str):
    """Unique CKT IDs in order of appearance."""
    return list(dict.fromkeys(re.findall(regex, text or "")))


def with_retries(fn, retries: int, wait: float):
    """Run fn(); on ConnectorError try again `retries` more times with a growing pause."""
    last = None
    for attempt in range(retries + 1):
        try:
            return fn()
        except ConfigError:
            raise
        except ConnectorError as e:
            last = e
            if attempt < retries:
                time.sleep(wait * (attempt + 1))
    raise last
