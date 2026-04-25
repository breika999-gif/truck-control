web: python -c "from database import init_db; init_db()" && gunicorn app:app --workers 2 --timeout 120 --bind 0.0.0.0:$PORT
