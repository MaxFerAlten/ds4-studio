import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FUNCTION_STUDY_SECTIONS,
  formatFunctionStudyReport,
  formatSageReport
} from "./sageReportFormatter.mjs";

function runtimeReport(report) {
  return { authority: "runtime", validationPassed: true, ...report };
}

function artifact(runId, kind, seed) {
  const sha256 = String(seed).repeat(64).slice(0, 64);
  const artifactId = `sha256:${sha256}`;
  return {
    artifactId,
    runId,
    kind,
    name: `${kind}.png`,
    mediaType: "image/png",
    sha256,
    sizeBytes: 128,
    createdAt: "2026-07-13T00:00:00.000Z",
    url: `/api/sage/artifacts/${runId}/${encodeURIComponent(artifactId)}`
  };
}

function functionStudyFixture() {
  return runtimeReport({
    kind: "function_study_v1",
    expression: "1/x^2",
    variable: "x",
    function: { latex: "f(x)=\\frac{1}{x^2}" },
    domain: {
      excluded_points: ["0"],
      components: [
        { left: "-inf", right: "0", left_open: true, right_open: true },
        { left: "0", right: "inf", left_open: true, right_open: true }
      ]
    },
    symmetry: { kind: "even" },
    intercepts: { x: [], y: null },
    function_sign_rows: [
      {
        interval: { left: "-inf", right: "0", left_open: true, right_open: true },
        sample_point: "-1",
        sign: "+",
        evaluated_value: "1"
      },
      {
        interval: { left: "0", right: "inf", left_open: true, right_open: true },
        sample_point: "1",
        sign: "+",
        evaluated_value: "1"
      }
    ],
    limits: [],
    asymptotes: [{ kind: "vertical", equation: "x=0" }],
    first_derivative: {
      reported: "-2/x^3",
      sign_rows: [
        {
          interval: { left: "-inf", right: "0", left_open: true, right_open: true },
          sample_point: "-1",
          sign: "+",
          evaluated_value: "2"
        },
        {
          interval: { left: "0", right: "inf", left_open: true, right_open: true },
          sample_point: "1",
          sign: "-",
          evaluated_value: "-2"
        }
      ]
    },
    critical_points: [{
      x: "0.1234567890123456789",
      value: "64/9",
      left_sign: "+",
      right_sign: "-",
      classification: "local_maximum"
    }],
    absolute_extrema: { minimum: null, maximum: null },
    component_ranges: [
      { left: "0", right: "1", left_open: true, right_open: false },
      { left: "2", right: "inf", left_open: false, right_open: true }
    ],
    range: [
      { left: "0", right: "1", left_open: true, right_open: false },
      { left: "2", right: "inf", left_open: false, right_open: true }
    ],
    second_derivative: {
      reported: "6/x^4",
      sign_rows: [{
        sample_point: "-1|certified",
        sign: "+",
        evaluated_value: "6"
      }]
    },
    inflection_points: [],
    conclusion: "FREEFORM_SHOULD_NEVER_APPEAR /tmp/private Traceback secret"
  });
}

test("formatters reject reports that are not runtime-authoritative", () => {
  assert.equal(formatSageReport(null), "");
  assert.equal(formatSageReport({ kind: "math_report" }), "");
  assert.equal(formatSageReport({
    authority: "model",
    validationPassed: true,
    kind: "math_report"
  }), "");
  assert.equal(formatFunctionStudyReport({
    authority: "runtime",
    validationPassed: false,
    kind: "function_study_v1"
  }), "");
});

test("generic runtime report keeps canonical section order and KaTeX", () => {
  const report = runtimeReport({
    kind: "math_report",
    title: "Risoluzione",
    sections: [
      { id: "conclusion", title: "Conclusione", markdown: "Fine.", formulas: [] },
      { id: "result", title: "Risultato", markdown: "$x=2$.", formulas: ["x=2"] },
      { id: "setup", title: "Impostazione", markdown: "Dato iniziale.", formulas: [] }
    ]
  });
  const markdown = formatSageReport(report);

  assert.ok(markdown.indexOf("## Impostazione") < markdown.indexOf("## Risultato"));
  assert.ok(markdown.indexOf("## Risultato") < markdown.indexOf("## Conclusione"));
  assert.match(markdown, /\$\$\nx=2\n\$\$/);
  assert.doesNotMatch(markdown, /\\\(|\\\[|\\\)|\\\]/);
});

test("function-study formatter emits the exact 21-section golden order", () => {
  const runId = "run-golden";
  const artifacts = [
    artifact(runId, "function_plot", "a"),
    artifact(runId, "first_derivative_plot", "b"),
    artifact(runId, "second_derivative_plot", "c")
  ];
  const markdown = formatFunctionStudyReport(functionStudyFixture(), { artifacts });

  const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, [
    "Funzione",
    "Dominio",
    "Continuità e regolarità",
    "Simmetrie",
    "Intersezioni",
    "Segno",
    "Limiti",
    "Asintoti",
    "Derivata prima",
    "Tabella segni di f'",
    "Monotonia",
    "Estremi locali",
    "Estremi assoluti e limitatezza",
    "Immagine",
    "Derivata seconda",
    "Tabella segni di f''",
    "Concavità",
    "Flessi",
    "Grafici",
    "Riepilogo",
    "Nota runtime"
  ]);
  assert.equal(FUNCTION_STUDY_SECTIONS.length, 21);
});

test("function-study golden preserves exact values and runtime classifications", () => {
  const markdown = formatFunctionStudyReport(functionStudyFixture());

  assert.match(markdown, /0\.1234567890123456789/);
  assert.match(markdown, /64\/9/);
  assert.match(markdown, /Massimo locale/);
  assert.match(markdown, /\(0, 1\] \\cup \[2, \\infty\)/);
  assert.match(markdown, /Nessun flesso presente nel report validato/);
  assert.doesNotMatch(markdown, /FREEFORM_SHOULD_NEVER_APPEAR|\/tmp|Traceback|private/);
});

test("function-study golden embeds exactly the three immutable run artifacts", () => {
  const runId = "run-artifacts";
  const artifacts = [
    artifact(runId, "function_plot", "a"),
    artifact(runId, "first_derivative_plot", "b"),
    artifact(runId, "second_derivative_plot", "c"),
    { name: "legacy.png", url: "/api/sage/artifacts/by-name/legacy.png" }
  ];
  const markdown = formatFunctionStudyReport(functionStudyFixture(), { artifacts });

  assert.equal((markdown.match(/^!\[/gm) || []).length, 3);
  assert.doesNotMatch(markdown, /by-name|latest|\/home\/|\/mnt\//);
  assert.match(markdown, /sha256%3A/);
});

test("formatter output is stable, table-safe, and has balanced KaTeX delimiters", () => {
  const report = functionStudyFixture();
  const first = formatFunctionStudyReport(report);
  const second = formatFunctionStudyReport(structuredClone(report));

  assert.equal(first, second);
  assert.match(first, /-1\\\|certified/);
  assert.equal((first.match(/\$\$/g) || []).length % 2, 0);
  assert.doesNotMatch(first, /\\\(|\\\[|\\\)|\\\]/);
});

test("generic artifacts also require immutable artifact IDs", () => {
  const runId = "run-generic";
  const report = runtimeReport({
    kind: "math_report",
    title: "Con grafico",
    sections: [{ id: "result", title: "Risultato", markdown: "OK", formulas: [] }]
  });
  const markdown = formatSageReport(report, {
    artifacts: [artifact(runId, "function_plot", "d")]
  });

  assert.match(markdown, /## Grafici e artefatti/);
  assert.match(markdown, /sha256%3A/);
});
