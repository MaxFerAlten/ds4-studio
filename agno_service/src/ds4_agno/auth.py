from hmac import compare_digest

from fastapi import Header, HTTPException, status


class ServiceAuthenticator:
    """Bearer token authentication for AgentOS DS4 routes."""

    def __init__(self, expected_token: str):
        self._expected = expected_token

    async def require(
        self, authorization: str | None = Header(default=None)
    ) -> None:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="missing bearer token",
            )
        supplied = authorization.removeprefix("Bearer ").strip()
        if not compare_digest(supplied, self._expected):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="invalid bearer token",
            )
