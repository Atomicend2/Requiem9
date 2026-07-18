---
name: better-sqlite3 native build
description: How to manually compile better-sqlite3 for Node 20 (ABI v115) when no pre-built binary exists
---

Node.js 20.x uses module ABI v115. better-sqlite3 v12.11.1 has no pre-built binary for v115 (releases only cover v127, v137, v141, v147+). Compiling via `node-gyp rebuild` fails because the SQLite amalgamation (~230K lines) is too CPU-intensive for the Replit sandbox and gets killed.

**Solution:** compile manually in steps:

1. `cc -O0 -fPIC -DNDEBUG -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_ENABLE_DBSTAT_VTAB -DSQLITE_ENABLE_DESERIALIZE -DSQLITE_ENABLE_FTS3 -DSQLITE_ENABLE_FTS3_PARENTHESIS -DSQLITE_ENABLE_FTS4 -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_GEOPOLY -DSQLITE_ENABLE_JSON1 -DSQLITE_ENABLE_MATH_FUNCTIONS -DSQLITE_ENABLE_PERCENTILE -DSQLITE_ENABLE_RTREE -DSQLITE_ENABLE_STAT4 -DSQLITE_ENABLE_UPDATE_DELETE_LIMIT -DSQLITE_THREADSAFE=2 -DSQLITE_ENABLE_API_ARMOR -c deps/sqlite3/sqlite3.c -o <path>/sqlite3.o`
2. `ar rcs sqlite3.a sqlite3.o`
3. `g++ <node-gyp defs and includes> -O0 -fPIC -pthread -std=gnu++17 -fno-rtti -fno-exceptions -c src/better_sqlite3.cpp -o better_sqlite3.o`
4. `g++ -shared -pthread -rdynamic -Wl,-Bsymbolic better_sqlite3.o sqlite3.a -o build/Release/better_sqlite3.node`

**Why -O0:** -O2/-O3 compilation of the SQLite amalgamation gets OOM-killed. -O0 is slower at runtime but compiles successfully.

**Critical:** ALL the `-DSQLITE_ENABLE_*` defines must be present or the binary will have missing symbols (e.g. `sqlite3_column_origin_name`) and crash with ERR_DLOPEN_FAILED.

The output path must be `build/Release/better_sqlite3.node` — that's where `bindings` looks via the default `node-pre-gyp` path convention.
