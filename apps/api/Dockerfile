FROM python:3.12-slim

# Fail fast, no .pyc, unbuffered logs so docker logs are useful.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Copy the manifest first so this layer is cached until dependencies actually change.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user.
RUN useradd --create-home --uid 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "syncaai.main:app", "--host", "0.0.0.0", "--port", "8000"]
