"""CLI entry point for the DS4-Agno service."""

import uvicorn
from ds4_agno.settings import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(
        "ds4_agno.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=False,
        access_log=False,
        proxy_headers=False,
        forwarded_allow_ips="",
    )


if __name__ == "__main__":
    main()
