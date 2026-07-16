# Build script name from caller's name.
COMMONDIR=$(cd $(dirname ${BASH_SOURCE[0]}); pwd)
me=$(basename "$0" .sh)

node $COMMONDIR/../input/$me/test-re1.js
node $COMMONDIR/../input/$me/test-re2.js
node $COMMONDIR/../input/$me/test-lang-re.js

node $COMMONDIR/../input/$me/test-re3.js
