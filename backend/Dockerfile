FROM python:3.11-slim

WORKDIR /app

# Works from repo root (Railway default build context)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

ENV PORT=8080
EXPOSE 8080

CMD ["python", "app.py"]
