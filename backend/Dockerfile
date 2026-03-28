FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# v2 — force cache bust
COPY backend/ .

ENV PORT=8080
EXPOSE 8080

CMD ["python", "app.py"]
