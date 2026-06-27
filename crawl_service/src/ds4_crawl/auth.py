from __future__ import annotations

from hmac import compare_digest

from fastapi import HTTPException, status


def verify_bearer(authorization: str | None, expected_token: str) -> None:
    scheme, separator, supplied_token = (authorization or "").partition(" ")
    candidate = supplied_token if separator and scheme.lower() == "bearer" else ""
    matches = compare_digest(candidate.encode("utf-8"), expected_token.encode("utf-8"))
    if not matches or not separator or scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
