# Sample Output Notes

After `analyze`, look under:

- `.reposherlock/output/<timestamp>/report.md`
- `.reposherlock/output/<timestamp>/architecture.mmd`
- `.reposherlock/output/<timestamp>/risks.md`
- `.reposherlock/output/<timestamp>/issues.json`
- `.reposherlock/output/<timestamp>/issues.sarif`
- `.reposherlock/output/<timestamp>/README_2.0.md`
- `.reposherlock/output/<timestamp>/logs.jsonl`

If `--try-run` is enabled:

- `.reposherlock/output/<timestamp>/run_attempt.md`

If `--llm` is enabled:

- deterministic and llm variant files for report/issues/readme.
