#!/bin/bash
# Runs inside the virtual Mac as its user. Puts node in ~/loep-voiceover, next to reader.js
# that loep copied there; nothing system-wide. A fixed version. reader.js needs no packages.
# Says per step "DONE <step>: ..." or "TODO <step>: ...". Safe to run again.
NODE_VERSION=v24.21.0
DIR="$HOME/loep-voiceover"
done_() { echo "DONE $1: $2"; }
todo() { echo "TODO $1: $2"; exit 1; }
limit() { perl -e 'alarm shift; exec @ARGV' "$@"; }
cd "$DIR" || todo files "de map $DIR ontbreekt"

if [ "$("$DIR/node/bin/node" --version 2>/dev/null)" != "$NODE_VERSION" ]; then
  limit 300 curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-arm64.tar.gz" -o node.tar.gz || todo node "kon node $NODE_VERSION niet ophalen van nodejs.org"
  rm -rf node && mkdir node && tar xzf node.tar.gz -C node --strip-components 1 && rm node.tar.gz
fi
export PATH="$DIR/node/bin:$PATH"
[ "$(node --version)" = "$NODE_VERSION" ] && done_ node "$NODE_VERSION in $DIR/node" || todo node "node $NODE_VERSION staat er niet"
