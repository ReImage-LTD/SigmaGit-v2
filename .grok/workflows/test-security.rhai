let meta = #{
    name: "test-security",
    description: "Run SigmaGit security unit tests and report failures",
    when_to_use: "After security changes, or to verify the security test suite still passes",
    phases: [
        #{ title: "Run tests", detail: "Execute bun test for apps/api security suite" },
        #{ title: "Report", detail: "Summarize pass/fail and any remaining gaps" },
    ],
};

let result_schema = #{
    "type": "object",
    "required": ["passed", "summary", "failed_tests"],
    "properties": #{
        "passed": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "failed_tests": #{
            "type": "array",
            "items": #{ "type": "string" },
        },
        "notes": #{ "type": "string" },
    },
};

phase("Run tests");

let prompt = "";
prompt += "Run the SigmaGit API security unit test suite and report results.\n\n";
prompt += "Steps (you MUST use the shell):\n";
prompt += "1. cd apps/api && bun test src/test\n";
prompt += "2. Capture the full output.\n";
prompt += "3. If any tests fail, re-run the failing file alone to confirm.\n\n";
prompt += "Then set:\n";
prompt += "- passed: true only if exit code is 0 and zero failures\n";
prompt += "- summary: short human-readable result (counts)\n";
prompt += "- failed_tests: list of failed test names (empty if all pass)\n";
prompt += "- notes: any warnings or flakes observed\n";

let r = agent(prompt, #{
    label: "run-security-tests",
    capability_mode: "execute",
    output_schema: result_schema,
});

phase("Report");

if r == () || !r.success {
    complete(#{
        passed: false,
        summary: "Test runner agent failed",
        failed_tests: ["agent-execution-failed"],
        notes: "Could not execute bun test",
    });
}

let out = r.output;
let report = "# Security test workflow result\n\n";
report += "- **Passed:** " + out.passed.to_string() + "\n";
report += "- **Summary:** " + out.summary + "\n";
if out.failed_tests != () {
    report += "- **Failed tests:** " + json_encode(out.failed_tests) + "\n";
}
if out.notes != () {
    report += "- **Notes:** " + out.notes + "\n";
}

let path = write_scratch_file("security-test-report.md", report);
complete(#{
    path: path,
    passed: out.passed,
    summary: out.summary,
    failed_tests: out.failed_tests,
});
