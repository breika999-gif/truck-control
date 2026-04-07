import sqlite3
import os

db_path = 'truckai.db'
print(f"Checking {db_path} in current directory ({os.getcwd()})")
if os.path.exists(db_path):
    db = sqlite3.connect(db_path)
    print('Tables:', db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall())
else:
    print(f"{db_path} does not exist here.")
