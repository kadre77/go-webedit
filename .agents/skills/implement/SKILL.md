---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and `make check` (the full suite) once at the end. Commit only on green. A test that fails intermittently is a bug: diagnose it with the "diagnosing-bugs" skill, or file it as a `needs-triage` issue and tell the user. It is never "pre-existing" and skipped past.

Once done, call the Skill tool with "code-review" to review the work. Settle every review finding, one of three ways:

- **Fixed.** Fixes made after the review get one more review, of just that diff.
- **Recorded as a decision** in the spec or the ticket's Comments, when the user agrees.
- **Filed** as a `needs-triage` issue in `.scratch/<feature>/issues/`.

A finding that is still open, or an open question for the Owner, keeps the ticket out of `done`.

Commit your work to the current branch. The pre-commit hook runs `make check-fast`; enable it with `make hooks` if it is off.
