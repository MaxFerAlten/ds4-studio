"""Il pacchetto grafico di uno studio di funzione ha tre artefatti, non uno.

Il validator runtime pretende function_plot, first_derivative_plot e
second_derivative_plot; finche' la pipeline ne produceva uno solo, nessuno
studio di funzione poteva essere pubblicato.
"""
import re
from pathlib import Path

from src.agent.tools.sage.models import SageExecutionResult
from src.agent.tools.sage.orchestrator import SageOrchestrator

SAVE_PATH = re.compile(r'graph\.save\(\s*"([^"]+)"')


class FakeExecutor:
    """Esegue il codice plot scrivendo un PNG finto dove il codice lo chiede."""

    def __init__(self, skip: frozenset[str] = frozenset()):
        self.skip = skip
        self.calls = []

    def execute(self, code: str, request_dir: Path, attempt: int = 1) -> SageExecutionResult:
        self.calls.append(code)
        match = SAVE_PATH.search(code)
        if match and Path(match.group(1)).name not in self.skip:
            target = Path(match.group(1))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"\x89PNG" + b"0" * 2000)
        return SageExecutionResult(
            ok=True, exit_code=0, stdout="", stderr="", duration_ms=1,
            timed_out=False, code_path=str(request_dir), attempt=attempt,
        )


def _orchestrator(executor) -> SageOrchestrator:
    orchestrator = SageOrchestrator(runtime_base=Path("/tmp/ds4-sage-plot-test"))
    orchestrator.executor = executor
    return orchestrator


def test_function_study_produces_three_artifact_kinds(tmp_path):
    orchestrator = _orchestrator(FakeExecutor())
    artifacts = orchestrator._build_plot_package(
        request_dir=tmp_path,
        variable="x",
        plots=[
            ("function_plot", "plot.png", "x^2 - 1"),
            ("first_derivative_plot", "plot_first_derivative.png", "2*x"),
            ("second_derivative_plot", "plot_second_derivative.png", "2"),
        ],
    )

    assert [artifact["kind"] for artifact in artifacts] == [
        "function_plot",
        "first_derivative_plot",
        "second_derivative_plot",
    ]
    for artifact in artifacts:
        assert Path(artifact["path"]).exists()
        assert artifact["media_type"] == "image/png"


def test_a_missing_plot_is_absent_not_phantom(tmp_path):
    orchestrator = _orchestrator(FakeExecutor(skip=frozenset({"plot_second_derivative.png"})))
    artifacts = orchestrator._build_plot_package(
        request_dir=tmp_path,
        variable="x",
        plots=[
            ("function_plot", "plot.png", "x^2 - 1"),
            ("first_derivative_plot", "plot_first_derivative.png", "2*x"),
            ("second_derivative_plot", "plot_second_derivative.png", "2"),
        ],
    )

    kinds = [artifact["kind"] for artifact in artifacts]
    assert "second_derivative_plot" not in kinds
    assert len(kinds) == 2


def test_plot_code_is_generated_through_the_real_signature(tmp_path):
    """build_plot_code(request: PlotRequest): la vecchia chiamata a keyword
    sollevava TypeError e la pipeline non arrivava mai a produrre un grafico."""
    executor = FakeExecutor()
    orchestrator = _orchestrator(executor)
    orchestrator._build_plot_package(
        request_dir=tmp_path,
        variable="x",
        plots=[("function_plot", "plot.png", "x^2 - 1")],
    )

    assert executor.calls, "nessun codice plot generato"
    assert 'graph.save(' in executor.calls[0]
    assert "x^2 - 1" in executor.calls[0]


def test_request_id_is_reproducible():
    """str(hash(...)) dipendeva da PYTHONHASHSEED: stessa richiesta, directory
    di runtime diversa a ogni processo."""
    from src.agent.tools.sage.orchestrator import sha256_text

    assert sha256_text("studio di funzione x^2")[:16] == sha256_text("studio di funzione x^2")[:16]
    assert len(sha256_text("x")[:16]) == 16
