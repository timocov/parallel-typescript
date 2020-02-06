# parallel-typescript

**IT USES THE PRIVATE COMPILER'S API SO PLEASE DON'T USE IT IN PRODUCTION. IT'S JUST A POC!**

This is a test repo of straightforward implementation of parallel compilation of TypeScript's composite projects.

It uses an idea that all independent sub-projects might be build in parallel in workers/different processes.
It _doesn't_ share state between sub-projects compilations (because it seems that compiler API doesn't support (de-)serialization of the state).

## Example

Let's say you have solution with 4 projects, and dependency tree has the following structure:

```text
   A
 /   \
B  C  D
 \ | /
   E
```

Here we can run in parallel compilation of `B`, `C` and `D` projects after `E` project is built.
Thus you can run the following commands yourself:

```bash
tsc -b ./E

# run this ones in parallel
tsc -b ./B
tsc -b ./C
tsc -b ./D

# and run this one after all
tsc -b ./A
```

This is exactly what the tool does for you!

It relies that re-parsing (parsing/type-checking/etc) types from deps sub-projects and running in parallel _might be_ faster than re-using types in the same thread/process and running compilation of all sub-projects sequentially.
But I'm not sure about that (I'm looking for the project who can test it and compare the results) so _we need to test it before using anywhere._
