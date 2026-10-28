# Branches

Kevin works on `main` and commits and pushes there directly.

Steph (Kevin's duo partner) works on the `steph` branch and opens pull requests from it every so often to get
her changes merged into `main`. When you're working with Steph, in any session:

- Switch to `steph` before making changes (`git fetch origin steph && git checkout -B steph origin/steph`; a fresh
  clone may track only `main`), and commit and push there. Never to `main` or a new branch unless asked to.
- To bring in Kevin's latest work, merge `main` into `steph`.
- When Steph asks for her changes to go into `main`, open a pull request from `steph` to `main`. Don't merge it
  yourself unless asked to.
- If you can't tell whether you're working with Steph or Kevin, ask before committing.
