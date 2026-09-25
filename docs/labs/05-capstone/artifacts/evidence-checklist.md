# Evidence checklist

Use this checklist against your own station repository evidence. Do not treat it as a release approval.

## Automated checks can establish

- The exact commit SHA named by a workflow run, check run, deployment record, or pull request event.
- The identity of the workflow, check name, actor, timestamp, and conclusion that GitHub recorded.
- Whether required checks are present, completed, and attached to the revision you are judging.
- Whether dependency review, code scanning, secret protection, unit tests, and build checks reported a pass, fail, or missing result.
- Whether CODEOWNERS or branch protection required review for the changed paths.
- Whether a deployment or environment record names the same revision, a different revision, or no revision.

## Automated checks cannot establish

- Whether the product intent was correct or complete.
- Whether the implemented scope fully satisfies the business need.
- Whether the approver held release authority for this service.
- Whether a deployment should be approved now.
- Whether advisory agent text is true without deterministic evidence.
- Whether absence of evidence is safe. Missing, stale, or wrong-revision evidence remains a defect.

## Verify the revision

- Record the Lab 2 pull request number.
- Record the pull request head SHA that reviewers saw.
- Record the default-branch merge SHA, if the pull request was merged.
- Choose the one revision your decision judges.
- For every check, review, approval, and deployment record, record the SHA it names.
- If an artifact names a different SHA, mark it as a defect unless another trusted artifact maps the two revisions.

## Verify the evidence

- Intent: the issue or pull request explains why the reservation suggestion feature was needed.
- Proposal: the pull request diff shows the code and workflow changes under review.
- Deterministic checks: named build, test, dependency, security, and policy checks completed for the judged revision.
- Governance: CODEOWNERS or review policy names who should review the changed paths.
- Approval: a human review or documented decision accepted the change for merge.
- Delivery readiness: release inputs are consistent and no required pre-release evidence is missing.
- Deployment outcome: if a deployment already happened, its record and any health evidence name the deployed revision.
- Recurrence: the Lab 1 workflow-owned issue, if produced, or an explicitly attendee-created issue records the next bounded decision and owner.

## Decide

- Release: evidence is complete for the chosen release-readiness decision, and a named release owner still approves the release.
- Block: required evidence is missing, stale, failed, or bound to the wrong revision.
- Escalate: evidence is ambiguous or authority is unclear, and a named owner must decide.
