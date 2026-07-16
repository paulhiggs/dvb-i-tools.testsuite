# Tests for Examples in the A177 specification

me=$(basename "$0" .sh)
COMMONDIR=$(cd $(dirname ${BASH_SOURCE[0]}); pwd)
SOURCES=()
for src in "$COMMONDIR"/../input/test-006/SL/*.xml; do
    SOURCES+=($src)
done

node $COMMONDIR/../test-runner.js --mode sl --nomarkup --src ${SOURCES[@]} $@