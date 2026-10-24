"""SageMath orchestration V2: assembles all components into a deterministic pipeline.

Entry point for the JS→Python bridge.
"""
import hashlib
from pathlib import Path
from typing import Any, Optional

from .classifier import classify_sage_task
from .exceptions import (
    SageExecutionFailedControlled,
    SageQualityGateFailed,
    SageResultParseError,
    FinalCodeMutationError,
)
from .executor import SageExecutor
from .error_classifier import classify_sage_error
from .interval_engine import split_interval_at_exclusions
from .katex_validator import validate_katex_document
from .mathematical_validator import validate_function_study
from .models import (
    SageRequest,
    SageTaskType,
    SageResponse,
    FunctionStudyResult,
    PlotRequest,
    ValidationReport,
    SageExecutionResult,
)
from .normalizer import normalize_numeric_value
from .parser import extract_result_json, validate_schema
from .planner import build_plan
from .plot_builder import build_plot_code, validate_plot
from .prompt_loader import SagePromptLoader
from .quality_gate import can_publish, requires_plots
from .renderer import render_function_study
from .repair import SageRepairEngine, apply_repair_cycle
from .telemetry import SageTelemetry
from .templates.function_study import (
    build_function_study_code,
    validate_expression_source,
)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class SageOrchestrator:
    """Main orchestrator for SageMath V2 pipeline.

    Composes classifier, planner, executor, repair, parser, normalizer,
    interval engine, sign engine, extrema engine, concavity engine,
    asymptote engine, plot builder, mathematical validator, KaTeX validator,
    renderer, quality gate, and telemetry.
    """

    def __init__(
        self,
        sage_binary: str = "sage",
        timeout_seconds: int = 30,
        prompt_path: Optional[Path] = None,
        runtime_base: Optional[Path] = None,
    ):
        self.classifier = classify_sage_task
        self.prompt_loader = SagePromptLoader(prompt_path or Path("/dev/null"))
        self.executor = SageExecutor(
            sage_binary=sage_binary,
            timeout_seconds=timeout_seconds,
        )
        self.repair_engine = SageRepairEngine()
        self.telemetry = SageTelemetry()

        if runtime_base is None:
            runtime_base = Path("runtime/sage")
        self.runtime_base = runtime_base

    def run(self, raw_request: dict, context: Any = None) -> SageResponse:
        """Execute the full Sage orchestration pipeline.

        Args:
            raw_request: dict with keys 'code', 'task_type', 'phase',
                         'output_mode', 'timeout_sec'
            context: optional session context

        Returns:
            SageResponse with document, plot_path, code, metadata
        """
        # Build structured request
        user_text = raw_request.get("code", "")
        task_type_str = raw_request.get("task_type", "auto")

        # The request id must be reproducible across processes: str(hash(...))
        # depends on PYTHONHASHSEED, so the same request landed in a different
        # runtime directory on every run.
        request = SageRequest(
            request_id=sha256_text(user_text)[:16],
            raw_user_text=user_text,
            expression=user_text,
        )

        # Classify
        if task_type_str == "auto" or not task_type_str:
            detected = self.classifier(user_text)
            request.task_type = detected
        else:
            try:
                request.task_type = SageTaskType(task_type_str)
            except ValueError:
                request.task_type = SageTaskType.SYMBOLIC_GENERIC

        self.telemetry.record_request(request)

        # Load prompt (only for Sage V2)
        startup_prompt = self.prompt_loader.load()
        policy_metadata = self.prompt_loader.metadata

        # Build plan
        plan = build_plan(request)

        # Create runtime directory
        request_dir = self.runtime_base / str(request.request_id)
        request_dir.mkdir(parents=True, exist_ok=True)

        # For FUNCTION_STUDY: use template + executor cycle
        if request.task_type == SageTaskType.FUNCTION_STUDY:
            return self._run_function_study(
                request,
                request_dir,
                startup_prompt,
                policy_metadata,
            )

        # Generic fallback: execute code directly via existing toolSage logic
        # This is handled by the JS bridge calling the legacy path
        raise NotImplementedError(
            f"Sage V2 does not yet handle task type {request.task_type}"
        )

    def _run_function_study(
        self,
        request: SageRequest,
        request_dir: Path,
        startup_prompt: str,
        policy_metadata: Any,
    ) -> SageResponse:
        """Execute a complete function study pipeline."""
        if not startup_prompt.strip():
            raise RuntimeError("Sage policy prompt is empty")
        expression = request.expression.strip()

        # Validate expression safety
        validate_expression_source(expression)

        # Build initial code from template
        candidate_code = build_function_study_code(
            expression=expression,
            variable=request.variable,
        )

        # Execute with repair cycle
        execution, final_code = apply_repair_cycle(
            executor=self.executor,
            request_dir=request_dir,
            code=candidate_code,
            error_classifier_fn=classify_sage_error,
            repair_engine=self.repair_engine,
        )

        if not execution.ok:
            raise SageExecutionFailedControlled(
                "Function study execution failed after max attempts"
            )

        # Parse structured JSON output
        raw_result = extract_result_json(execution.stdout)
        schema_missing = validate_schema(raw_result)
        if schema_missing:
            raise SageResultParseError(
                f"Missing required keys: {', '.join(schema_missing)}"
            )

        # Normalize values
        result = FunctionStudyResult(
            expression=str(raw_result.get("expression", "")),
            variable=str(raw_result.get("variable", "x")),
        )

        # Domain processing via interval engine
        domain_exclusions = []
        excluded_raw = raw_result.get("domain", {}).get("excluded_points", [])
        for e in excluded_raw:
            try:
                domain_exclusions.append(float(e))
            except (ValueError, TypeError):
                pass

        # Derivative roots as floats
        deriv_roots = []
        for r_str in raw_result.get("derivative_roots", []):
            try:
                deriv_roots.append(float(r_str))
            except (ValueError, TypeError):
                pass

        second_deriv_roots = []
        for r_str in raw_result.get("second_derivative_roots", []):
            try:
                second_deriv_roots.append(float(r_str))
            except (ValueError, TypeError):
                pass

        # Build the plot package. A function study owes three artifact kinds —
        # the function and both derivatives — and the runtime validator refuses
        # to publish without all three, so producing one PNG was never enough.
        first_derivative = str(raw_result.get("first_derivative", "")).strip()
        second_derivative = str(raw_result.get("second_derivative", "")).strip()
        artifacts = self._build_plot_package(
            request_dir=request_dir,
            variable=request.variable,
            plots=[
                ("function_plot", "plot.png", expression),
                ("first_derivative_plot", "plot_first_derivative.png",
                 first_derivative or f"diff({expression}, {request.variable})"),
                ("second_derivative_plot", "plot_second_derivative.png",
                 second_derivative or f"diff({expression}, {request.variable}, 2)"),
            ],
        )

        result.plot_path = artifacts[0]["path"] if artifacts else None
        if len(artifacts) < 3:
            self.telemetry.record_plot_failure()

        # Final code: use the executed template code
        result.final_sage_code = final_code

        # Validate mathematics
        math_report = validate_function_study(result)
        if not math_report.passed:
            self.telemetry.record_validation_failure("math")

        # Render document
        document = render_function_study(result)

        # Validate KaTeX
        katex_report = validate_katex_document(document, target="obsidian")
        if not katex_report.passed:
            self.telemetry.record_validation_failure("katex")

        # Re-execute final code for hash verification
        final_hash_before = sha256_text(final_code)
        reexec = self.executor.execute(final_code, request_dir, attempt=99)
        final_hash_after = sha256_text(final_code)

        if final_hash_before != final_hash_after:
            raise FinalCodeMutationError(
                "Final code hash changed after re-execution"
            )

        # Quality gate
        plot_ok = len(artifacts) >= 3
        if not can_publish(
            math_report=math_report,
            katex_report=katex_report,
            final_execution=reexec,
            plot_ok=plot_ok,
            task_type=request.task_type.value,
        ):
            self.telemetry.record_quality_gate_failure()
            raise SageQualityGateFailed(
                "Function study failed quality gate checks"
            )

        self.telemetry.record_final_success()

        return SageResponse(
            document=document,
            plot_path=result.plot_path,
            code=result.final_sage_code,
            artifacts=artifacts,
            metadata={
                "task_type": request.task_type.value,
                "math_validated": math_report.passed,
                "katex_validated": katex_report.passed,
                "plot_ok": plot_ok,
                "requires_plots": requires_plots(request.task_type.value),
                "artifact_kinds": [artifact["kind"] for artifact in artifacts],
                "attempts": execution.attempt,
                "policy": {
                    "name": policy_metadata.name,
                    "version": policy_metadata.version,
                    "sha256": policy_metadata.sha256,
                },
            },
        )

    def _build_plot_package(self, *, request_dir, variable, plots):
        """Render one PNG per requested plot kind.

        Returns only the artifacts that actually landed on disk: a missing plot
        must be visible to the orchestration as a missing artifact, not hidden
        behind a path that points at nothing.
        """
        artifacts = []
        for index, (kind, file_name, expression) in enumerate(plots, start=1):
            if not expression:
                continue
            output_path = str(request_dir / file_name)
            plot_code = build_plot_code(
                PlotRequest(
                    expression=expression,
                    variable=variable,
                    output_path=output_path,
                )
            )
            self.executor.execute(plot_code, request_dir, attempt=index)
            if not validate_plot(output_path):
                continue
            artifacts.append({
                "kind": kind,
                "name": file_name,
                "path": output_path,
                "media_type": "image/png",
            })
        return artifacts
