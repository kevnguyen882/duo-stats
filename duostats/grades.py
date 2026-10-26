"""Champion mastery grades: S+ down to D-."""

from __future__ import annotations

import time

GRADE_ORDER = ["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"]


def grade_rank(grade) -> int:
    """0 for S+, 1 for S ... lower is better; 99 for no grade."""
    try:
        return GRADE_ORDER.index(str(grade).strip().upper())
    except ValueError:
        return 99


def is_s_rank(grade) -> bool:
    return grade_rank(grade) <= 2   # S-, S or S+


def better(a, b):
    """The better of two grades (either may be empty)."""
    return a if grade_rank(a) <= grade_rank(b) else b


def best_grade(entry: dict) -> str:
    """Best grade in a mastery entry: the season best if present, else the best on the current milestone."""
    best = entry.get("highestGrade") or ""
    for g in entry.get("milestoneGrades") or []:
        if isinstance(g, str):
            best = better(g, best) if best else g
    return best


def season_start_ms() -> int:
    """Mastery grades reset with the ranked season, which starts each January."""
    t = time.localtime()
    return int(time.mktime((t.tm_year, 1, 1, 0, 0, 0, 0, 0, -1)) * 1000)


def now_ms() -> int:
    return int(time.time() * 1000)
