import logging
import json
from src import contract_addresses
from src.models import IPLDBlacklistBlock, BlacklistedIPLD
from src.tasks.celery_app import celery
from src.tasks.ipld_blacklist import ipld_blacklist_state_update
from src.tasks.generate_trending import generate_trending

logger = logging.getLogger(__name__)


######## HELPER FUNCTIONS ########


def update_trending_cache(self, db, redis, time):
    logger.error(f"index_cache.py | Update trending cache {time}")
    resp = generate_trending(db, time, None, 100, 0)
    resp_json = json.dumps(resp)
    redis_key = f"trending-{time}"
    logger.error(redis_key)
    redis.set(redis_key, resp_json)



# Update cache for all trending timeframes
def update_all_trending_cache(self, db, redis):
    logger.error(f"index_cache.py | Update all trending cache")
    update_trending_cache(self, db, redis, "day")
    update_trending_cache(self, db, redis, "week")
    update_trending_cache(self, db, redis, "month")
    update_trending_cache(self, db, redis, "year")

######## CELERY TASKS ########

@celery.task(name="update_discovery_cache", bind=True)
def update_discovery_cache(self):
    # Cache custom task class properties
    # Details regarding custom task context can be found in wiki
    # Custom Task definition can be found in src/__init__.py
    db = update_discovery_cache.db
    redis = update_discovery_cache.redis
    # Define lock acquired boolean
    have_lock = False
    # Define redis lock object
    update_lock = redis.lock("update_discovery_lock", timeout=7200)
    try:
        # Attempt to acquire lock - do not block if unable to acquire
        have_lock = update_lock.acquire(blocking=False)
        if have_lock:
            update_all_trending_cache(self, db, redis)
        else:
            logger.info("index_cache.py | Failed to acquire update_discovery_lock")
    except Exception as e:
        logger.error("index_cache.py | Fatal error in main loop", exc_info=True)
        raise e
    finally:
        if have_lock:
            update_lock.release()
