# Добавяме в backend/app.py
#
# 1. В началото на файла, след другите globals:
#
#    tacho_live_context = {}   # Живи данни от тахографа — вкарват се в Gemini system prompt
#
# 2. Новият endpoint:

@app.route('/api/tacho/live_update', methods=['POST'])
def tacho_live_update():
    """
    Получава live data от BLE тахографа и го запазва в паметта.
    Gemini го чете при всеки следващ чат.
    """
    global tacho_live_context
    data = request.get_json(force=True)
    ctx = data.get('tacho_live_context', {})

    tacho_live_context = {
        'current_activity':      ctx.get('current_activity', 'Неизвестно'),
        'activity_code':         ctx.get('activity_code', -1),
        'driving_time_left_min': ctx.get('driving_time_left_min', 0),
        'daily_driven_min':      ctx.get('daily_driven_min', 0),
        'speed_kmh':             ctx.get('speed_kmh', 0),
        'timestamp':             ctx.get('timestamp', ''),
    }
    return {'ok': True}


# 3. В Gemini system prompt — добавяш тази функция и я викаш в /api/gemini/chat:

def _build_tacho_context_block() -> str:
    """Форматира tacho_live_context за Gemini system prompt."""
    if not tacho_live_context:
        return ''

    rem_h  = tacho_live_context['driving_time_left_min'] // 60
    rem_m  = tacho_live_context['driving_time_left_min'] % 60
    drv_h  = tacho_live_context['daily_driven_min'] // 60
    drv_m  = tacho_live_context['daily_driven_min'] % 60

    return f"""
ТАХОГРАФ (live BLE данни):
- Текуща активност: {tacho_live_context['current_activity']}
- Изкарано днес: {drv_h}ч {drv_m}мин
- Оставащо каране: {rem_h}ч {rem_m}мин
- Скорост от сензор: {tacho_live_context['speed_kmh']} км/ч
- Последно обновяване: {tacho_live_context['timestamp']}

Ако шофьорът пита за оставащо време или почивка — използвай горните данни.
Ако остават < 30 мин — предупреди проактивно и предложи да потърсиш паркинг.
"""

# 4. В /api/gemini/chat endpoint — добавяш към system prompt-а:
#
#    system_prompt = GEMINI_SYSTEM_PROMPT + _build_tacho_context_block()
