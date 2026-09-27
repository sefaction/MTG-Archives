FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir numpy==2.2.6 opencv-python-headless==4.12.0.88 pillow==11.3.0
ENV OMP_THREAD_LIMIT=1 OPENBLAS_NUM_THREADS=1
WORKDIR /eval
COPY baseline.py /eval/baseline.py
ENTRYPOINT ["python", "/eval/baseline.py"]
