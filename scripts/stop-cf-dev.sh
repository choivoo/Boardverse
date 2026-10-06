#!/bin/sh
# stop local wrangler/workerd dev processes (patterns are specific so they cannot match unrelated command lines)
pkill -f "node_modules/wrangler/bin/wrangler[.]js" 2>/dev/null
pkill -x workerd 2>/dev/null
sleep 2
exit 0
