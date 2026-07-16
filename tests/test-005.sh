# Tests for Service List Registry responses

me=$(basename "$0" .sh)
COMMONDIR=$(cd $(dirname ${BASH_SOURCE[0]}); pwd)
SOURCES=()
for src in "$COMMONDIR"/../input/$me/*.xml; do
    SOURCES+=($src)
done

node $COMMONDIR/../test-runner.js --mode slr --nomarkup --src ${SOURCES[@]} $@

