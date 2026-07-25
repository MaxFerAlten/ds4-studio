"""Test bearer token authentication."""

import pytest
from fastapi import HTTPException
from ds4_agno.auth import ServiceAuthenticator


@pytest.mark.asyncio
async def test_missing_header():
    auth = ServiceAuthenticator(expected_token="valid-token-abcdef123456")
    with pytest.raises(HTTPException) as exc:
        await auth.require(authorization=None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_non_bearer_header():
    auth = ServiceAuthenticator(expected_token="valid-token-abcdef123456")
    with pytest.raises(HTTPException) as exc:
        await auth.require(authorization="Basic xyz")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_wrong_token():
    auth = ServiceAuthenticator(expected_token="valid-token-abcdef123456")
    with pytest.raises(HTTPException) as exc:
        await auth.require(authorization="Bearer wrong-token")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_correct_token():
    auth = ServiceAuthenticator(expected_token="valid-token-abcdef123456")
    # Should not raise
    await auth.require(authorization="Bearer valid-token-abcdef123456")
