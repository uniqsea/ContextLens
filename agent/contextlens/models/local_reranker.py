"""The reranker that needs no key and sends nothing anywhere: bge-reranker-v2-m3 (int8 ONNX) run on this
machine with fastembed, like the embedding model. It reads a question and a passage together and says how
likely the passage answers it, which a vector's closeness cannot. It is fetched once by `npm run setup`;
a turn never downloads anything, so without the file, files are ranked as before, by words and meaning.

On an M4 it judges a dozen passages in about a second and peaks near 1.8 GB, so it is loaded only when
a project's files are searched and released with the embedding model once previews stop (api.py).
"""
from __future__ import annotations

import logging
import math
from collections import OrderedDict
from collections.abc import Callable
from functools import cache
from threading import Lock

from contextlens import config

log = logging.getLogger(__name__)
MODEL = "BAAI/bge-reranker-v2-m3-int8"
_BATCH = 1  # a batch pads every pair to its longest; one at a time was faster (docs/adr/0004)
_KEPT = 512  # scores remembered; the preview asks again for every pause in typing

Judge = Callable[[str, list[str]], list[float] | None]
_load_lock = Lock()
_scores: OrderedDict[tuple[str, str], float] = OrderedDict()
_scores_lock = Lock()
_override: Judge | None = None
_missing = False  # the file was looked for and is not here; asked again only after a release


def scores(question: str, texts: list[str]) -> list[float] | None:
    """How likely each text answers the question, from 0 to 1; None when there is no reranker."""
    global _missing
    if not texts:
        return []
    if _override is not None:
        return _override(question, texts)
    with _scores_lock:
        known = {t: _scores[(question, t)] for t in texts if (question, t) in _scores}
    missing = list(dict.fromkeys(t for t in texts if t not in known))
    if missing:
        if _missing:
            return None
        try:
            model = _model()
        except Exception as e:
            _missing = True
            log.warning("no local reranker, files ranked without it: %s", str(e)[:200])
            return None
        # The model gives a logit; its sigmoid is the probability it was trained to predict.
        fresh = [1 / (1 + math.exp(-s)) for s in model.rerank(question, missing, batch_size=_BATCH)]
        with _scores_lock:
            for text, score in zip(missing, fresh):
                _scores[(question, text)] = score
                known[text] = score
            while len(_scores) > _KEPT:
                _scores.popitem(last=False)
    return [known[t] for t in texts]


def use(judge: Judge | None) -> None:
    """Score with `judge` instead of the model, e.g. in tests; a judge returning None stands for no
    reranker. Pass None to use the model again."""
    global _override
    _override = judge


def fetch() -> None:
    """Download the model file if it is not here yet."""
    _load(local_files_only=False)


def release_cache():
    global _missing
    _missing = False
    with _load_lock:
        _cached_model.cache_clear()
    with _scores_lock:
        _scores.clear()


def _model():
    with _load_lock:
        return _cached_model()


@cache
def _cached_model():
    return _load(local_files_only=True)


def _load(*, local_files_only: bool):
    from fastembed.rerank.cross_encoder import TextCrossEncoder

    return TextCrossEncoder(MODEL, cache_dir=str(config.ensure_home() / "models"), local_files_only=local_files_only)
