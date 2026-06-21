from redis import Redis
from config import REDIS_URL

_redis_client: "Redis | None" = None


def get_redis() -> "Redis | None":
    global _redis_client
    if not REDIS_URL:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        from redis import Redis

        client = Redis.from_url(REDIS_URL, decode_responses=True)
        client.ping()
        _redis_client = client
        return _redis_client
    except Exception:
        return None
