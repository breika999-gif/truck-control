import sqlite3
db = sqlite3.connect('backend/truckai.db')
print('Tables:', db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall())
try:
    print('Count:', db.execute("SELECT COUNT(*) FROM transparking_cache").fetchone()[0])
except Exception as e:
    print('Error:', e)
