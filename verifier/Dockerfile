FROM python:3.12-slim

WORKDIR /app

# CPU-only PyTorch keeps the image much smaller than the default build.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY verify_worker.py .

# Run as a normal user, not root.
RUN useradd --create-home worker
USER worker

CMD ["python", "verify_worker.py"]
