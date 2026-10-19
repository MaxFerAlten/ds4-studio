import pytest

from h2ds4.errors import Code, H2DS4Error
from h2ds4.model.proxy import normalize_compatible_request


@pytest.mark.parametrize('store', [False, True])
def test_store_hint_is_removed_for_local_backend(store):
    body = {'model': 'local', 'messages': [], 'store': store}

    assert normalize_compatible_request(body) == {'model': 'local', 'messages': []}
    assert body['store'] is store


def test_store_hint_must_be_boolean():
    with pytest.raises(H2DS4Error) as exc:
        normalize_compatible_request({'store': 'true'})

    assert exc.value.code == Code.INVALID_INPUT
