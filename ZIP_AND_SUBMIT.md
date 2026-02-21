# ZIP_AND_SUBMIT.md

## Final Packaging & Upload Instructions

Use this as the final step before submission.

---

## 1) Files that must be present

- `README.md`
- `PROBLEM.md`
- `SOLUTION.md`
- `RUNBOOK.md`
- source code
- `.env.example`

Optional:
- `ARCHITECTURE.md`
- `TESTING.md`
- demo assets
- `QA_SELF_CHECK.md` (optional but recommended)

---

## 2) Do not include these in zip

- `node_modules/`, `.venv/`, `vendor/`
- `dist/`, `build/`, `target/`, `.cache/`
- `.git/`, `.DS_Store`, temporary/log files
- real secrets (`.env` with production keys/tokens)

---

## 3) Recommended zip structure

```text
team-name_project-name.zip
├── README.md
├── PROBLEM.md
├── SOLUTION.md
├── RUNBOOK.md
├── .env.example
├── /src ...
├── /backend ...
├── /frontend ...
└── /docs ...
```

---

## 4) Zip commands

### macOS/Linux

```bash
zip -r team-name_project-name.zip . \
  -x "*/node_modules/*" "*/.venv/*" "*/dist/*" "*/build/*" \
     "*/target/*" "*/.cache/*" "*/.git/*" "*/.DS_Store" "*.log" "*.tmp"
```

### Windows PowerShell

```powershell
Compress-Archive -Path * -DestinationPath team-name_project-name.zip
```

Then manually remove heavy/temp/secrets if included.

---

## 5) Final checklist

- [ ] Required files are present
- [ ] RUNBOOK is executable and complete
- [ ] SOLUTION claims are verifiable
- [ ] No real secrets are included
- [ ] Zip excludes heavy/temporary folders
- [ ] Zip opens cleanly

Upload this final zip to the hackathon submission channel.
