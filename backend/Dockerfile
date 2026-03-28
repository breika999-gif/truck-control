FROM python:3.11-slim

WORKDIR /app

# Copy source first — any app.py change busts all layers below
COPY backend/ .

RUN pip install --no-cache-dir -r requirements.txt

ENV PORT=8080
EXPOSE 8080

CMD ["python", "app.py"]
