from datetime import datetime
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path

# Define log directory at project root: backend/logs/
BASE_DIR = Path(__file__).resolve().parent.parent.parent
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "server_logs.log"

def setup_logging(level: str = "INFO") -> logging.Logger:
    """
    Configures application and framework logging to write to a rotating log file.
    - Limits size to 30MB per file with up to 5 backups.
    - Captures application, uvicorn, and framework logs.
    - Formats timestamps as DD-MM-YY HH:MM:SS.
    """
    # Write startup banner on server launch once
    if not os.environ.get("SERVER_BANNER_PRINTED"):
        now_str = datetime.now().strftime("%d-%m-%Y %H:%M:%S")
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(f"\n========================\nServer started at - {now_str}\n========================\n")
            os.environ["SERVER_BANNER_PRINTED"] = "1"
        except Exception:
            pass

    # Create rotating file handler (Max 30 MB, 5 backups)
    file_handler = RotatingFileHandler(
        filename=LOG_FILE,
        maxBytes=30 * 1024 * 1024,  # 30MB
        backupCount=5,
        encoding="utf-8"
    )

    # Custom log namer (converts 'server_logs.log.1' into 'server_logs_2.log')
    def custom_log_namer(default_name: str) -> str:
        parts = default_name.rsplit(".log.", 1)
        if len(parts) == 2 and parts[1].isdigit():
            base, count_str = parts
            count = int(count_str)
            return f"{base}_{count + 1}.log"
        return default_name

    file_handler.namer = custom_log_namer

    # Formatter: DD-MM-YY HH:MM:SS
    file_formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%d-%m-%y %H:%M:%S"
    )
    file_handler.setFormatter(file_formatter)

    # Configure root and application loggers
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)
    
    for h in list(root_logger.handlers):
        root_logger.removeHandler(h)
    root_logger.addHandler(file_handler)

    project_logger = logging.getLogger("deep_research")
    project_logger.setLevel(numeric_level)
    project_logger.propagate = True

    # Attach file handler to Uvicorn framework loggers
    for uvicorn_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        u_logger = logging.getLogger(uvicorn_logger_name)
        u_logger.setLevel(numeric_level)
        u_logger.propagate = True

    # Silence noisy external libraries
    logging.getLogger("watchfiles.main").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("faiss").setLevel(logging.WARNING)
    logging.getLogger("faiss.loader").setLevel(logging.WARNING)
    logging.getLogger("google_genai").setLevel(logging.ERROR)

    return project_logger

logger = setup_logging()
