FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source — works whether build context is repo root or backend/
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["python", "app.py"]
