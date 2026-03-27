from pathlib import Path
import sys

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture()
def temp_data_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data_root = tmp_path / ".mely-test"
    monkeypatch.setenv("MELY_DATA_DIR", str(data_root))
    monkeypatch.delenv("MELY_APP_ENV", raising=False)
    return data_root
