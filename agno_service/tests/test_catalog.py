"""Test the catalog module."""

from ds4_agno.catalog import CatalogEntry, get_default_catalog


def test_catalog_entry_model():
    entry = CatalogEntry(id="test-agent", kind="agent", name="Test Agent")
    assert entry.id == "test-agent"
    assert entry.kind == "agent"
    assert entry.name == "Test Agent"
    assert entry.description == ""
    assert entry.enabled is True


def test_default_catalog_has_ds4_assistant():
    catalog = get_default_catalog()
    assert len(catalog) == 1
    entry = catalog[0]
    assert entry.id == "ds4-assistant"
    assert entry.kind == "agent"
    assert entry.name == "DS4 Assistant"
    assert entry.enabled is True


def test_catalog_entry_json_serializable():
    entry = CatalogEntry(id="test-agent", kind="agent", name="Test Agent")
    data = entry.model_dump()
    assert isinstance(data, dict)
    assert data["id"] == "test-agent"
