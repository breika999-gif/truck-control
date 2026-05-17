from datetime import date, timedelta, datetime as dt
from database import get_db

def _analyze_weekly_rests(user_email: str, week_start: str) -> dict:
    REGULAR_S, REDUCED_S, MAX_REDUCED = 39_600, 32_400, 3
    with get_db() as db:
        sessions = db.execute("SELECT start_time, end_time FROM tacho_sessions WHERE date >= ? AND user_email = ? AND end_time IS NOT NULL ORDER BY start_time ASC", (week_start, user_email)).fetchall()
    regular, reduced = 0, 0
    for i in range(len(sessions) - 1):
        try:
            gap_s = (dt.fromisoformat(sessions[i+1]["start_time"]) - dt.fromisoformat(sessions[i]["end_time"])).total_seconds()
            if gap_s >= REGULAR_S: regular += 1
            elif gap_s >= REDUCED_S: reduced += 1
        except: pass
    return {"weekly_regular_rests": regular, "weekly_reduced_rests": reduced, "reduced_rests_remaining": max(0, MAX_REDUCED - reduced)}

def _tacho_summary(user_email: str = "") -> dict:
    today_dt = date.today()
    today, week_start = today_dt.isoformat(), (today_dt - timedelta(days=today_dt.weekday())).isoformat()
    prev_week_start = (today_dt - timedelta(days=today_dt.weekday() + 7)).isoformat()
    DAILY_LIMIT, WEEKLY_LIMIT, BIWEEKLY_LIMIT, CONTINUOUS_LIMIT = 32400, 201600, 324000, 16200

    with get_db() as db:
        daily_s = int(db.execute("SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions WHERE date=? AND user_email=? AND type='driving'", (today, user_email)).fetchone()["t"])
        weekly_s = int(db.execute("SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions WHERE date>=? AND user_email=? AND type='driving'", (week_start, user_email)).fetchone()["t"])
        prev_weekly_s = int(db.execute("SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions WHERE date>=? AND date<? AND user_email=? AND type='driving'", (prev_week_start, week_start, user_email)).fetchone()["t"])
        sessions = db.execute("SELECT type, driven_seconds FROM tacho_sessions WHERE date=? AND user_email=? ORDER BY start_time ASC", (today, user_email)).fetchall()
        extended_days_used = int(db.execute("""
            SELECT COUNT(*) AS cnt FROM (
                SELECT date FROM tacho_sessions
                WHERE date >= ? AND date < ? AND user_email = ? AND type='driving'
                GROUP BY date HAVING SUM(driven_seconds) > 32400
            )
        """, (week_start, today, user_email)).fetchone()["cnt"])

    effective_daily_limit_s = 36000 if extended_days_used < 2 else DAILY_LIMIT

    continuous_s, first_split_done = 0, False
    for sess in sessions:
        if sess["type"] == 'driving': continuous_s += int(sess["driven_seconds"])
        elif sess["type"] in ('break', 'rest'):
            dur = int(sess["driven_seconds"])
            if dur >= 2700 or (dur >= 1800 and first_split_done): continuous_s, first_split_done = 0, False
            elif dur >= 900: first_split_done = True

    rests = _analyze_weekly_rests(user_email, week_start)
    biweekly_s = weekly_s + prev_weekly_s
    return {
        "daily_driven_s": daily_s, "daily_remaining_s": max(0, effective_daily_limit_s - daily_s),
        "daily_driven_h": round(daily_s/3600, 2), "daily_remaining_h": round(max(0, effective_daily_limit_s - daily_s)/3600, 2),
        "weekly_driven_s": weekly_s, "weekly_remaining_s": max(0, WEEKLY_LIMIT - weekly_s),
        "weekly_driven_h": round(weekly_s/3600, 2), "weekly_remaining_h": round(max(0, WEEKLY_LIMIT - weekly_s)/3600, 2),
        "continuous_driven_s": continuous_s, "continuous_remaining_s": max(0, CONTINUOUS_LIMIT - continuous_s),
        "continuous_driven_h": round(continuous_s/3600, 2), "continuous_remaining_h": round(max(0, CONTINUOUS_LIMIT - continuous_s)/3600, 2),
        "break_needed": continuous_s >= CONTINUOUS_LIMIT,
        "biweekly_driven_h": round(biweekly_s/3600, 2),
        "biweekly_remaining_h": round(max(0, BIWEEKLY_LIMIT - biweekly_s)/3600, 2),
        "biweekly_limit_h": round(BIWEEKLY_LIMIT / 3600, 2),
        "weekly_regular_rests": rests["weekly_regular_rests"],
        "weekly_reduced_rests": rests["weekly_reduced_rests"],
        "reduced_rests_remaining": rests["reduced_rests_remaining"],
        "daily_limit_h": 10 if extended_days_used < 2 else 9,
        "weekly_limit_h": 56,
        "date": today,
        "week_start": week_start
    }

def _tool_calculate_hos_reach(driven_seconds: int, speed_kmh: float, user_email: str = "") -> dict:
    summary = _tacho_summary(user_email)
    remaining_s = min(max(0, 16200 - driven_seconds), summary["daily_remaining_s"])
    h, m = divmod(int(remaining_s), 3600)
    return {"remaining_h": h, "remaining_min": m // 60, "remaining_km": round((remaining_s / 3600) * speed_kmh), "break_needed": remaining_s <= 0, "daily_remaining_h": summary["daily_remaining_h"], "weekly_remaining_h": summary["weekly_remaining_h"]}
