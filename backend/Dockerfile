FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Always copy fresh — no cache for app code
COPY backend/ .
RUN echo "Build timestamp: $(date)" && python -c "import py_compile; py_compile.compile('app.py', doraise=True) or print('app.py OK')"

ENV PORT=8080
EXPOSE 8080

CMD ["python", "app.py"]
