import hashlib
import random
from uuid import uuid4

from sentinel.db import get_db
from sentinel.models import SurgeryType

_OUTCOMES = ["recovered", "recovered", "recovered", "readmitted", "sepsis", "died"]
_SURGERIES = list(SurgeryType)
_SUMMARIES = {
    "recovered": "Post-op day {d}: mild pain, eating, ambulating, normal vitals.",
    "readmitted": "Post-op day {d}: fever, tachycardia, returned to ED.",
    "sepsis": "Post-op day {d}: febrile, breathless, confused — sepsis confirmed.",
    "died": "Post-op day {d}: delayed presentation, septic shock, deceased.",
}


def _det_embedding(case_id: str, dim: int = 1536) -> list[float]:
    rng = random.Random(int(hashlib.sha256(case_id.encode()).hexdigest()[:8], 16))
    v = [rng.gauss(0.0, 1.0) for _ in range(dim)]
    n = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / n for x in v]


async def seed_cohort(count: int = 20, *, seed: int | None = None) -> None:
    """Seed cohort_outcomes with `count` synthetic cases.

    Deterministic when `seed` is provided; otherwise uses a fresh RNG so that
    parallel test runs don't interfere with each other via the global RNG.
    """
    rng = random.Random(seed)
    db = get_db()
    await db.cohort_outcomes.delete_many({})
    docs: list[dict] = []
    for _ in range(count):
        case_id = str(uuid4())
        outcome = rng.choice(_OUTCOMES)
        day = rng.randint(1, 14)
        surgery = rng.choice(_SURGERIES)
        docs.append(
            {
                "_id": case_id,
                "case_id": case_id,
                "surgery_type": surgery.value,
                "day": day,
                "summary": _SUMMARIES[outcome].format(d=day),
                "embedding": _det_embedding(case_id),
                "outcome": outcome,
            }
        )
    await db.cohort_outcomes.insert_many(docs)
