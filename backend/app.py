import os
from flask import Flask
from flask_cors import CORS
from config import FLASK_PORT, FLASK_DEBUG
from database import init_db, start_background_tasks
from routes.chat import chat_bp
from routes.gemini import gemini_bp
from routes.poi import poi_bp
from routes.tacho import tacho_bp
from routes.misc import misc_bp

app = Flask(__name__)
cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        "APP_CORS_ORIGINS",
        "https://truckexpoai.com,https://www.truckexpoai.com,https://breika999-gif.github.io",
    ).split(",")
    if origin.strip()
]
CORS(app, resources={r"/api/*": {"origins": cors_origins}})

# Register Blueprints
app.register_blueprint(chat_bp)
app.register_blueprint(gemini_bp)
app.register_blueprint(poi_bp)
app.register_blueprint(tacho_bp)
app.register_blueprint(misc_bp)

# Initialize DB schema and background tasks (works with both gunicorn and dev server)
if os.environ.get("WERKZEUG_RUN_MAIN") != "false":
    init_db()
    start_background_tasks()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=FLASK_PORT, debug=FLASK_DEBUG)
