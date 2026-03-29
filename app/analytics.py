from __future__ import annotations

from time import perf_counter


class Timer:
    def __init__(self) -> None:
        self._start = perf_counter()

    def elapsed_ms(self) -> int:
        return int((perf_counter() - self._start) * 1000)
