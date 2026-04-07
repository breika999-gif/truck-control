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
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Register Blueprints
app.register_blueprint(chat_bp)
app.register_blueprint(gemini_bp)
app.register_blueprint(poi_bp)
app.register_blueprint(tacho_bp)
app.register_blueprint(misc_bp)

if __name__ == "__main__":
    # Initialize DB schema
    init_db()
    # Start background threads (Transparking cache, etc.)
    start_background_tasks()
    
    # Run Flask
    app.run(host="0.0.0.0", port=FLASK_PORT, debug=FLASK_DEBUG)
