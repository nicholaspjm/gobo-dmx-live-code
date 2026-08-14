# Governance

Short version: nobody owns this but the people who wrote it, and that is not
going to change.

## No contributor licence agreement, ever

There is no CLA and there will not be one. You keep the copyright in whatever
you contribute. Nothing here transfers rights to a person or a company, and no
single entity accumulates ownership over everyone else's work.

This is deliberate. A CLA is the mechanism by which an open project usually
becomes someone's asset: contributors sign their rights over, and the holder
can then relicense the whole thing, including into a proprietary product. With
no CLA that is not possible. Relicensing would need the agreement of everyone
who has contributed, which is the point.

The copyright line reads `gobo contributors` rather than a name, for the same
reason.

## Why AGPL

The browser app bundles [@strudel/core](https://strudel.cc), which is
AGPL-3.0-or-later, so the distributed app has to be as well. It also happens to
be the licence that matches the intent: anyone may use, study, change and share
this, but a changed version has to stay under the same terms, and section 13
extends that to running it as a network service. Someone hosting a modified
gobo has to publish their changes.

Plain GPL would not cover that case, and a permissive licence would let a
company fork it, close it and sell it.

The connector under `packages/bridge` is MIT, because it contains no AGPL code
and other lighting projects should be able to reuse it freely.

## Decisions

By discussion in the open, in issues and pull requests. There is a maintainer
because someone has to merge things and cut releases, not because they own it.

Disagreements are settled by argument rather than by rank. If that fails the
licence guarantees the last word: fork it, keep it free, and carry on.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Fixtures are the easiest place to
start.
