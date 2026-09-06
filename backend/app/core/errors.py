from typing import Any, Optional

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import logger

class AppException(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, detail: Optional[Any] = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.detail = detail
        super().__init__(message)

async def app_exception_handler(request: Request, exc: AppException):
    logger.error(f"AppException: [{exc.code}] {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "detail": exc.detail
            }
        }
    )

async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    first_msg = errors[0].get("msg") if errors else "Invalid request data."
    loc = errors[0].get("loc") if errors else []
    field_name = loc[-1] if loc else "field"
    clean_msg = f"Validation error on '{field_name}': {first_msg}"
    
    logger.warning(f"Request Validation Error: {clean_msg}")
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": clean_msg,
                "detail": errors
            }
        }
    )

async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    logger.warning(f"HTTPException: [{exc.status_code}] {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": "HTTP_ERROR",
                "message": str(exc.detail),
                "detail": None
            }
        }
    )

async def generic_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled Exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected server error occurred. Please try again.",
                "detail": str(exc)
            }
        }
    )

class EmbeddingRateLimitError(Exception):
    pass
