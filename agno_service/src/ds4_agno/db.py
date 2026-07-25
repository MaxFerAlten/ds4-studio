from pathlib import Path
from agno.db.sqlite import SqliteDb

def create_db(settings: "Settings") -> SqliteDb:
    """Create a SqliteDb instance for the Agno service."""
    db_file = settings.db_file
    db_file.parent.mkdir(parents=True, exist_ok=True)
    return SqliteDb(db_file=str(db_file))
