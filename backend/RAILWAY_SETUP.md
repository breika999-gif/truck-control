# Railway Persistent Storage Setup

1. В Railway dashboard → твоя service → **Volumes**
2. **Add Volume**: Mount Path = `/data`
3. **Add environment variable**: `DB_PATH` = `/data/truckai.db`
4. **Redeploy**

Без тези стъпки базата се изтрива при всеки deploy, тъй като файловата система на контейнерите е ephemeral.
